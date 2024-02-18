---
title: "Handle JavaScript Promises in a Better Way"
description: "Learn different strategies to handle data and errors in JavaScript promises."
pubDate: 2023-12-09
tags: ["technical", "javascript", "promises", "error-handling"]
---

If you're familiar with what promises are, you can skip the next section and jump straight to the approaches. Otherwise, read on!

## What are Promises?

The word "Promise" itself describes the concept of a commitment, signifying that something will occur in the future. A promise is a value that may not be available immediately but could be in the future.

In JavaScript, a promise is an object that represents the eventual completion or failure of an asynchronous operation and its resulting value. The program's execution does not halt while waiting for the promise to resolve; instead, it continues to execute the next line of code. The promise will be resolved or rejected at a later point. For example, a promise can be used to fetch data from an API. The promise will be resolved when the data is available, and the program can continue its execution. If an error occurs, the promise will be rejected, and the error can be handled appropriately.

The promise object has three states: _Pending_, _Fulfilled_, and _Rejected_. Consequently, handling the fulfilled and rejected states of the promise is crucial to maintaining the smooth execution of our program.

There are various ways to handle promises in JavaScript. In this article, we'll explore some of the most common approaches to handling data and errors in promises, discussing the pros and cons of each approach. Let's get started!

## Initial Setup

Suppose we have a function that returns a promise named `sayHi`. This function takes a boolean parameter called `shouldReject`. If `shouldReject` is `true`, the function returns a rejected promise; otherwise, it returns a resolved promise.

```js
function sayHi(shouldReject) {
  return new Promise((resolve, reject) => {
    if (shouldReject) {
      reject("No, I won't say Hi! 😡");
    }
    resolve("Hi! 😊");
  });
}
```

## Approach 1: Using `then`/`catch`

The first approach is to use the `then`/`catch` method. The `then` method handles the resolved data (usually), while `catch` deals with errors in promises. But both resolved data and errors can be handled in a single call using the `then` method.

```js
sayHi().then(
  (result) => console.log(result),
  (error) => console.log(error)
);

// Output: Hi! 😊
```

This approach is concise and convenient for simple scenarios. However, for complex chains with multiple promises, separate `then` and `catch` calls can enhance code readability and maintainability. This separation improves code organization, making success and error-handling logic clearer. For instance:

```js
sayHi(true)
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.log(error);
  });

// Output: No, I won't say Hi! 😡
```

While the `then`/`catch` method is common, it has some drawbacks. For instance, if multiple promises are used, the `catch` block captures errors from any point in the promise chain, leading to a lack of granularity in error handling.

```js
sayHi(true)
  .then((result) => {
    console.log(result);
  })
  .then(() => {
    console.log("This will not be executed");
  })
  .catch((error) => {
    console.log(error);
  });

// Output: No, I won't say Hi! 😡
```

This problem can be mitigated by using the `catch` method on each promise, but this results in more verbose code. Nesting too many `then`/`catch` blocks can also lead to "promise hell," making the code challenging to read and maintain.

```js
sayHi(true)
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.log(error);
  })
  .then(() => {
    console.log("This will be executed");
    throw new Error("This will be caught by the next catch block");
  })
  .catch((error) => {
    console.log(error.message);
  });

// Output:
// No, I won't say Hi! 😡
// This will be executed
// This will be caught by the next catch block
```

While `then` and `catch` are still widely used, some developers prefer the cleaner and more concise syntax of `async`/`await` for handling promises, especially in scenarios where a more synchronous-looking code is desired.

## Approach 2: Using `async`/`await`

The second approach involves using `async`/`await`. The `async` keyword defines an asynchronous function, while `await` is used to wait for a promise to resolve. The `await` keyword can only be used inside an `async` function and will pause the function's execution until the promise is resolved. It also catches any errors thrown by the promise, which can be handled using a `try`/`catch` block.

```js
async function asyncWrapper() {
  try {
    const result = await sayHi();
    console.log(result);
  } catch (error) {
    console.log(error);
  }
}

asyncWrapper();

// Output: Hi! 😊
```

The `async`/`await` syntax can be combined with the `catch` method syntax:

```js
const message = await sayHi(true).catch((error) => {
  console.log(error);
});
console.log(message);

// Output: No, I won't say Hi! 😡
```

However, a drawback is that if a rejection occurs, the execution of the next line where `message` is being used cannot be stopped. Additionally, outside the `catch` block, there is no access to the `error` object, making it impossible to check for errors before the execution of the next line.

Despite these limitations, the `async`/`await` syntax is more concise and easier to read than the `then`/`catch` syntax. It allows for more granular error handling using the `try`/`catch` block and includes a `finally` block to execute code after the promise is resolved or rejected.

```js
async function asyncWrapper() {
  try {
    const result = await sayHi(true);
    console.log(result);
  } catch (error) {
    console.log(error);
  } finally {
    console.log("This will be executed");
  }
}

asyncWrapper();

// Output:
// No, I won't say Hi! 😡
// This will be executed
```

We can also go with kinda `callback` pattern we're used to within Node.js. We can get both the data and the error from a single call and can easily handle them.

```js
async function asyncWrapper(promise) {
  try {
    const result = await promise;
    return [result];
  } catch (error) {
    return [, error];
  }
}

const [message, error] = await asyncWrapper(sayHi());
if (error) {
  console.log(error);
} else {
  console.log(message);
}

// Output: Hi! 😊
```

> Note: `null` or `undefined` can be returned instead of an empty array, for example, `return [result, null]` or `return [result, undefined]`. Another approach utilizing the `Promise.allSettled` method will be discussed shortly.

## Approach 3: Using `Promise.allSettled`

Concurrent promises can be handled using the `Promise.all` and `Promise.allSettled` methods. `Promise.allSettled` is used to wait for all promises to be settled. It takes an array of promises as an argument and returns a promise that is resolved when all promises are settled. The promise returned includes an array of objects, each with a `status` property and
a `value` when fulfilled or a `reason` when rejected.

```js
Promise.allSettled([sayHi(true), sayHi(false)]).then((results) => {
  console.log(results);
});

// Output:
// [
//   { status: 'rejected', reason: 'No, I won\'t say Hi! 😡' },
//   { status: 'fulfilled', value: 'Hi! 😊' }
// ]
```

If promises depend on each other, and immediate rejection is desired if any fails, `Promise.all` can be used. This method waits for all promises to be resolved and is rejected immediately if any promise is rejected. Errors can be handled using the `catch` method.

```js
Promise.all([sayHi(false), sayHi(false), Promise.resolve("Resolved!! 😁")])
  .then((results) => {
    console.log(results);
  })
  .catch((error) => {
    console.log(error);
  });

// Output: [ 'Hi! 😊', 'Hi! 😊', 'Resolved!! 😁' ]

Promise.all([sayHi(true), sayHi(false), sayHi(false)])
  .then((results) => {
    console.log(results);
  })
  .catch((error) => {
    console.log(error);
  });

// Output: No, I won't say Hi! 😡
```

The `async`/`await` syntax for handling data and errors in a single call can be achieved using the `Promise.allSettled` method:

```js
function asyncWrapper(promise) {
  return Promise.allSettled([promise]).then(([{ value, reason }]) => [
    value,
    reason,
  ]);
}

const [message, error] = await asyncWrapper(sayHi());
if (error) {
  console.log(error);
} else {
  console.log(message);
}

// Output: Hi! 😊
```

This approach appears more concise and readable than the `async`/`await` syntax!

> Other methods such as `Promise.race` and `Promise.any` exist to handle concurrent promises. You can read more about these [here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise#promise_concurrency).

## Conclusion

In this article, we explored different ways to handle errors in JavaScript promises, discussing the pros and cons of each approach. I hope you found this article useful. Thanks for reading! 😊
