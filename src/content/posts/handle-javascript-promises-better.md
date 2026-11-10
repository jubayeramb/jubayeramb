---
title: "Handle JavaScript Promise Errors Better"
description: "Handle promise errors in TypeScript: then/catch, try/catch, a typed result tuple, allSettled, AbortSignal timeouts and retries, with real output."
pubDate: 2023-12-09
updatedDate: 2026-11-11
tags: ["technical", "javascript", "promises", "error-handling"]
tldr:
  - "Use `async`/`await` with `try`/`catch` by default. Reach for `.then()`/`.catch()` only for short one-off chains."
  - "Wrap a promise in a small `attempt()` helper that returns `[error, data]` when you want to handle the error on the next line. With a tagged tuple type, TypeScript narrows `data` for you."
  - "`Promise.all` fails fast, `Promise.allSettled` never rejects, `Promise.any` wants one success. Pick by what a single failure should mean."
  - "A promise without a timeout can hang forever. `AbortSignal.timeout()` and `AbortSignal.any()` fix that for anything that accepts a signal."
  - "Retry only errors that can succeed on a second try, with backoff and jitter, and keep the last error as `cause`."
faq:
  - q: "Should I use then/catch or async/await?"
    a: "`async`/`await` for anything with more than one step. It reads top to bottom, lets you scope `try`/`catch` to the exact step that can fail, and gives you `finally`. A single `.then().catch()` is fine for a one-off call."
  - q: "What is the difference between Promise.all and Promise.allSettled?"
    a: "`Promise.all` rejects as soon as one promise rejects and gives you only that error. `Promise.allSettled` waits for every promise and never rejects; you get a `status` per item and decide what a failure means."
  - q: "How do I add a timeout to a promise?"
    a: "Pass `AbortSignal.timeout(ms)` to anything that accepts a signal, like `fetch`. It rejects with a `TimeoutError`. Combine it with your own `AbortController` through `AbortSignal.any()` when the user can also cancel."
  - q: "Why is the error in catch typed as unknown in TypeScript?"
    a: "Because anything can be thrown, not only `Error` objects. Narrow it with `error instanceof Error` before reading `.message`, or normalize it once in a helper."
  - q: "Should I reject a promise with a string?"
    a: "No. Reject with an `Error` (or a subclass). You get a stack trace, `instanceof` checks work, and you can chain the original failure through `cause`."
---

If you're familiar with what promises are, you can skip the next section and jump straight to the [setup](#setup).

> Note: I first wrote this post in December 2023.
> This version is rewritten in TypeScript and adds timeouts, retries, the newer `Promise` helpers, and the mistakes I see most often.
> Every code sample type-checks under `strict` and the output under each one is real (Node 25).

## What is a promise?

A promise is an object for a value that is not ready yet.
It starts _pending_, then settles once: _fulfilled_ with a value, or _rejected_ with a reason.
Your program keeps running while it waits.

Handling the rejected side is the part most code gets wrong.
An unhandled rejection crashes a Node process by default, and in the browser it fails quietly while the UI waits for something that never comes.

## Setup

Every example below uses this function.
It returns a promise that resolves with `"Hi!"`, or rejects with an `Error` when you pass `true`.

```ts
function sayHi(shouldReject = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (shouldReject) {
      reject(new Error("No, I won't say Hi!"));
      return;
    }
    resolve("Hi!");
  });
}
```

The old version of this post rejected with a plain string.
Don't do that: a string has no stack trace, `instanceof Error` fails, and you can't attach a `cause`.

## 1. `then` and `catch`

`.then()` handles the value and `.catch()` handles the error.
A single `.catch()` at the end catches a failure from any step above it.

```ts
await sayHi(true)
  .then((message) => console.log(message))
  .then(() => console.log("Skipped, the chain is already rejected"))
  .catch((error: unknown) => console.log("Caught:", (error as Error).message));
```

```
Caught: No, I won't say Hi!
```

That is convenient, and it is also the problem: the `.catch()` can't tell which step failed.
To handle each step on its own, you add a `.catch()` after it, and the chain recovers and keeps going:

```ts
await sayHi(true)
  .catch((error: Error) => console.log("Step 1 failed:", error.message))
  .then(() => {
    throw new Error("Step 2 failed");
  })
  .catch((error: Error) => console.log("Caught:", error.message));
```

```
Step 1 failed: No, I won't say Hi!
Caught: Step 2 failed
```

**Pros:** short for a one-off call, works without an `async` function.
**Cons:** per-step handling gets noisy fast, and values from earlier steps are awkward to reach in later ones.

## 2. `async`/`await` with `try`/`catch`

`await` pauses the function until the promise settles.
If it rejects, `await` throws, so a normal `try`/`catch` handles it.

```ts
async function greet() {
  try {
    const message = await sayHi(true);
    console.log(message);
  } catch (error) {
    console.log(error instanceof Error ? error.message : error);
  } finally {
    console.log("Runs either way");
  }
}

await greet();
```

```
No, I won't say Hi!
Runs either way
```

In TypeScript the `catch` variable is `unknown` under `strict`, because JavaScript lets you throw anything.
Narrow it with `instanceof Error` before you read `.message`.

You'll also see `await` mixed with `.catch()`:

```ts
const message = await sayHi(true).catch((error: Error) => {
  console.log(error.message);
});
console.log(message); // string | void
```

```
No, I won't say Hi!
undefined
```

This one is a trap.
The code after it still runs, with `message` set to `undefined`, and the error is gone by the time you're on the next line.
TypeScript does warn you (the type is `string | void`), so read that type before you move on.

**Pros:** reads top to bottom, `try` can wrap exactly the step that can fail, and `finally` is built in.
**Cons:** the `try` block scopes your variables, so you end up declaring `let` outside it, and deep nesting creeps back.

## 3. A typed `[error, data]` tuple

When I want to handle an error on the next line instead of in a `catch` block, I use a small helper that never throws.
It's the same idea as a Node callback's `(err, data)` or Go's `value, err`.

```ts
type Result<T> = [error: Error, data: undefined] | [error: undefined, data: T];

async function attempt<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return [undefined, await promise];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), undefined];
  }
}

const [error, message] = await attempt(sayHi(true));
if (error) {
  console.log("Failed:", error.message);
} else {
  console.log(message.toUpperCase()); // message is a string here
}
```

```
Failed: No, I won't say Hi!
```

The union type is what makes this worth it.
Once you check `error`, TypeScript knows `message` is a `string` in the `else` branch, with no `!` or `as`.
The helper also turns anything thrown into a real `Error` in one place.

The 2023 version of this post built the same thing on `Promise.allSettled`.
It works, but the `try`/`catch` version is shorter and doesn't allocate an array for one promise.

**Pros:** flat code, the error is a value you can return or log, and types narrow for you.
**Cons:** it's easy to forget the `if (error)` check, and nothing forces you to write it.

## 4. Many promises at once

Running independent work in parallel is where the choice of combinator matters most.
Each one gives a single failure a different meaning.

```ts
const results = await Promise.allSettled([sayHi(true), sayHi()]);
for (const result of results) {
  if (result.status === "fulfilled") console.log("ok:", result.value);
  else console.log("failed:", (result.reason as Error).message);
}

try {
  await Promise.all([sayHi(), sayHi(true), sayHi()]);
} catch (error) {
  console.log("Promise.all:", (error as Error).message);
}

const first = await Promise.any([sayHi(true), sayHi()]);
console.log("Promise.any:", first);

try {
  await Promise.any([sayHi(true), sayHi(true)]);
} catch (error) {
  const all = error as AggregateError;
  console.log(all.constructor.name, all.errors.length);
}
```

```
failed: No, I won't say Hi!
ok: Hi!
Promise.all: No, I won't say Hi!
Promise.any: Hi!
AggregateError 2
```

| Method               | Resolves when          | Rejects when                          | Use it for                                    |
| -------------------- | ---------------------- | ------------------------------------- | --------------------------------------------- |
| `Promise.all`        | every promise resolves | the first one rejects                 | steps that are useless without each other     |
| `Promise.allSettled` | every promise settles  | never                                 | independent work where partial success is fine |
| `Promise.any`        | the first one resolves | all of them reject (`AggregateError`) | fallbacks, like trying two mirrors            |
| `Promise.race`       | the first one settles  | the first one settles with an error   | rarely; a timeout race leaks the losing work  |

> Note: `Promise.all` rejects fast, but it doesn't stop the other promises.
> They keep running in the background.
> If they should stop, pass them an `AbortSignal` and abort it in your `catch`.

## 5. Timeouts and cancellation

A promise has no timeout of its own.
A request to a server that never answers can keep your code waiting forever.

`AbortSignal.timeout(ms)` gives you a signal that aborts itself.
Anything that accepts a `signal` (`fetch`, most Node APIs, your own functions) can use it.

```ts
const slow = (ms: number, signal?: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve("done"), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

try {
  await slow(5_000, AbortSignal.timeout(100));
} catch (error) {
  console.log((error as DOMException).name);
}
```

```
TimeoutError
```

When the user can also cancel, combine both with `AbortSignal.any()`.
Whichever fires first wins, and `signal.reason` tells you which one it was.

```ts
const userCancel = new AbortController();
const signal = AbortSignal.any([userCancel.signal, AbortSignal.timeout(5_000)]);
setTimeout(() => userCancel.abort(new Error("User pressed cancel")), 50);

try {
  await slow(1_000, signal);
} catch (error) {
  console.log((error as Error).message);
}
```

```
User pressed cancel
```

With `fetch` it's one line: `await fetch(url, { signal: AbortSignal.timeout(10_000) })`.
This is better than racing your promise against a `setTimeout` with `Promise.race`, because the race only stops you waiting while the request itself keeps running.

## 6. Retries with backoff

Some errors go away on a second try: a `503`, a dropped connection, a rate limit.
Others never will: a `400`, a validation error, a bug.
Only retry the first kind.

```ts
async function retry<T>(
  task: (attempt: number) => Promise<T>,
  { attempts = 3, baseMs = 200 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * baseMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed after ${attempts} attempts`, { cause: lastError });
}
```

The delay doubles each time (200 ms, 400 ms, 800 ms), plus random jitter.
The jitter matters when many clients fail at the same moment: without it they all retry at the same moment too.

```ts
let calls = 0;
const flaky = async () => {
  calls++;
  if (calls < 3) throw new Error(`Attempt ${calls} failed`);
  return "Hi!";
};

console.log(await retry(flaky, { baseMs: 10 }));

try {
  await retry(
    async () => {
      throw new Error("Server said 503");
    },
    { baseMs: 10 },
  );
} catch (error) {
  const e = error as Error;
  console.log(e.message, "|", (e.cause as Error).message);
}
```

```
Hi!
Failed after 3 attempts | Server said 503
```

`cause` keeps the original error attached, so your logs show both what gave up and why.
In a real app, add a check inside the `catch` that rethrows right away for errors that should not be retried.

## Two newer helpers worth knowing

**`Promise.withResolvers()`** (ES2024) returns a promise together with its `resolve` and `reject`.
It's for when the code that settles the promise lives somewhere else, like an event handler or a queue.

```ts
const { promise, resolve } = Promise.withResolvers<string>();
setTimeout(() => resolve("Resolved from outside"), 10);
console.log(await promise);
```

```
Resolved from outside
```

**`Promise.try()`** (ES2025) runs a function and always gives you a promise back.
If the function throws synchronously, you get a rejected promise instead of an exception that skips your `.catch()`.

```ts
function parseConfig(raw: string): { port: number } {
  return JSON.parse(raw); // throws synchronously on bad input
}

await Promise.try(() => parseConfig("{oops"))
  .then((config) => console.log(config.port))
  .catch((error: Error) => console.log("Caught:", error.name));
```

```
Caught: SyntaxError
```

Both work in current Chrome, Firefox, Safari and Node 24+.
For the types, `Promise.withResolvers` needs `lib` set to `ES2024` or later, and `Promise.try` needs `ESNext` (TypeScript 5.9).

## Mistakes I see most

- **Forgetting `await`.** The promise runs, nobody waits for it, and its error becomes an unhandled rejection. Turn on `@typescript-eslint/no-floating-promises`; it catches every one of these.
- **`await` inside `forEach`.** `forEach` ignores the promises your callback returns, so nothing waits. Use `for...of` to run them in order, or `Promise.all(items.map(...))` to run them in parallel.
- **Rejecting with strings or plain objects.** Use `Error`, and pass the original failure as `cause` when you wrap it.
- **Catching and doing nothing.** An empty `catch` hides the failure from you and from your logs. If you really mean to ignore an error, leave a comment that says why.
- **Swallowing in the middle of a chain.** A `.catch()` that logs and returns nothing turns a rejection into a resolved `undefined`, and the next step runs on it.

## The rule of thumb

Here is what I do:

1. `async`/`await` with `try`/`catch` by default.
2. `attempt()` when I want the error as a value on the next line.
3. `allSettled` for independent work, `all` when one failure makes the rest pointless.
4. A timeout on every network call.
5. Retries only for errors that can succeed the second time.

If you handle promise errors differently, or you think I got one of these wrong, I'd like to hear it.
The [contact page](/contact) has the fastest ways to reach me.

Thanks for reading! 🙏
