---
title: "Jev and System One Models: When You Need a Decision, Not a Chat"
description: "What TypeSafe AI's Jev is, how a System One Model differs from an LLM, what the workflow benchmarks actually show, and when it makes sense to reach for one."
pubDate: 2026-09-22
tags: ["technical", "ai", "llm", "agents", "automation"]
image:
  src: "./images/jev-system-one-model/hero.png"
  alt: "Cover with the word Jev in large type, the line \"A model that returns decisions, not text\", and a card of three typed answers: department technical at 0.85, frustration level 1 of 0 to 2, and is_urgent at 1.0."
tldr:
  - "Jev is TypeSafe AI's first System One Model. It does not generate text. You give it state and a set of typed questions, and it returns an answer for each one with probabilities."
  - "It is built for the decisions inside software: classify, route, score, flag. The LLM stays the right tool when the output is prose, code, or open-ended reasoning."
  - "On TypeSafe's own workflow evals, Jev averages 67.8% agreement with the reference at $0.0004 and 0.4 s per case. Sonnet 5 lands on the same 67.8% at $0.1174 and 78.1 s. The strongest LLMs still score higher, up to 74.1%."
  - "The most useful idea is not the speed. It is that every answer carries a calibrated confidence, so your code can act when it is sure and hand off to a person when it is not."
faq:
  - q: "What is Jev in one line?"
    a: "A model from TypeSafe AI that takes unstructured state and typed questions, and returns typed answers with probabilities instead of generated text."
  - q: "Is Jev an LLM?"
    a: "Not in the usual sense. It does not generate tokens one after another. It scores the options you define, all questions in one pass, which is why it cannot return a value outside your schema."
  - q: "Does Jev really never hallucinate?"
    a: "It never returns an invalid or made-up value, because it can only pick from the options you supplied. It can still pick the wrong option. TypeSafe's 0% figure is about type errors, and they say plainly it comes from the design, not from a measurement."
  - q: "When should I use an LLM instead?"
    a: "When the output is text: chat, drafting, code, summaries. Also when the task needs long multi-step reasoning. Jev is built for snap judgments that a knowledgeable person makes in about a second."
  - q: "How much does Jev cost?"
    a: "At launch, $42 per billion input tokens ($0.042 per million) with output tokens free. It is in early access, and TypeSafe notes it cannot yet prove the price is not subsidized."
---

Models have been good at chat for years.
So why is most automation in production still a pile of `if` statements?

That is the question TypeSafe AI opened their launch post with, and it is a fair one.
On September 15, 2026, after two years in stealth, they released **Jev**, the first model in a class they call **System One Models**.
It does not write text.
It makes decisions your code can use directly.

I have not had early access yet, so everything below comes from TypeSafe's [launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev), their [docs](https://docs.typesafe.ai/), and their [published workflow evals](https://evals.typesafe.ai/).
Where their numbers are strong, I say so.
Where they are weaker than the headline, I say that too.

## The 30-second answer

An LLM writes a string, and your code has to parse it, validate it, and hope it did not go off the rails.
Jev picks from answers you define in advance, and returns a probability for each one.

If the thing you need back is a sentence, use an LLM.
If the thing you need back is a branch in your code, that is what Jev is for.

## What is Jev?

Jev comes from TypeSafe AI, a San Francisco lab founded by Diogo Almeida, who worked at OpenAI on the instruction-following research that became ChatGPT.
TypeSafe describes Jev as "a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out."

The names are borrowed.
"System One" comes from Daniel Kahneman's [Thinking, Fast and Slow](https://www.penguinrandomhouse.com/books/89308/thinking-fast-and-slow-by-daniel-kahneman/): fast, intuitive System 1 judgment versus slow, deliberate System 2 reasoning.
"Jev" is after William Stanley Jevons, who noticed that cheaper coal led to more coal use, not less.
Their bet is the same for intelligence: make a decision cost a fraction of a cent and people will put one everywhere.

### How it differs from an LLM

TypeSafe changed three things at once: the architecture, the sampler, and the training method.
Here is their own comparison, condensed:

| | LLMs | Jev |
| --- | --- | --- |
| Trained for | Human preference (RLHF) or verifiable rewards (RLVR) | Calibrated decisions (RLCD, their new method) |
| Output | A string, parsed and validated by your code | Typed values, only from options you defined |
| Sampling | One token at a time, each depending on the last | All answers in one parallel pass |
| Confidence | Overconfident and inconsistent, even when asked | A probability on every answer |
| Speed | 3 to 329 s end to end for frontier models | 70 to 500 ms end to end |
| Price | $0.20 to $10 per million input tokens, output ~5x more | $0.042 per million input tokens, output free |

The sampling row is the one that explains the rest.
An LLM answering three questions has to write them out, token by token, in order.
Jev scores every option for every question at the same time.

<figure>
<video src="/assets/images/blog/jev-system-one-model/sampling.mp4" poster="/assets/images/blog/jev-system-one-model/sampling-poster.png" width="1600" height="900" autoplay muted loop playsinline preload="metadata" aria-label="Side by side animation. On the left an LLM types out a JSON answer one token at a time. On the right Jev fills in all three typed answers at once, each with a probability bar."></video>
<figcaption>An 8 second loop. Both sides start empty: Jev fills in all three answers at once while the LLM is still typing its first field.</figcaption>
</figure>

Giving up text is the whole trade.
Jev cannot write you an email.
In exchange it cannot return a department that does not exist, a score of "high-ish", or a refusal where a boolean should be.

## What a call looks like

There are three question types, and every answer comes back typed:

- **Choice.** One option from a set you define. Returns the choice, a probability for each option, and a confidence.
- **Score.** A level on a scale you describe. Returns a score, the probabilities per level, and a confidence.
- **Noul.** A yes or no. Returns the probability that it is true.

Here is the support ticket example from their quickstart, written with their TypeScript SDK, [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk).
One ticket, three questions, one call:

```ts
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const ticket =
  "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.";

const { answers } = await client.systemOne({
  state: ticket,
  questions: {
    department: choice("Which team should handle this", {
      billing: "Payment or subscription issues",
      technical: "Bugs or integration problems",
      sales: "Pricing or account questions",
    }),
    frustration: score("How frustrated the customer appears", [
      "Calm, just stating facts",
      "Frustrated but civil",
      "Very angry, strong language",
    ]),
    is_urgent: noul("The message conveys urgency or time-sensitivity"),
  },
});

answers.department.choice; // "billing" | "technical" | "sales"
answers.frustration.score; // number, 0 to 2
answers.is_urgent.noul; // number, probability of yes
```

The SDK infers each answer's type from its question, so `answers.department.choice` is the union of your three labels, not a `string`.

And the answers that come back (trimmed):

```json
{
  "department": {
    "choice": "technical",
    "confidence": 0.78,
    "probabilities": { "technical": 0.85, "billing": 0.15, "sales": 0.0 }
  },
  "frustration": { "score": 1.0, "confidence": 1.0 },
  "is_urgent": { "noul": 1.0 }
}
```

![One Jev call, left to right. A support ticket and three typed questions go into Jev. Out come typed answers with probabilities: technical at 0.85, frustration level 1, urgent at 1.0. Your code then gates on confidence: act, confirm, or route to a person.](/assets/images/blog/jev-system-one-model/how-a-call-works.png)

Notice what is missing.
No prompt asking for JSON, no parser, no retry when the model wraps the JSON in a sentence.
The shape of the answer is the shape of the question.

The docs are also clear about what makes a good question.
Ask for a judgment a knowledgeable person makes in a second, like "Does this message convey urgency?"
Do not ask it to "analyze this message and determine the best course of action."
If a decision depends on several factors, ask about each one separately and combine them in code, so a change in priorities is a change in weights, not a rewritten prompt.

## Confidence is the real feature

This line from the launch post is the best argument for the whole idea:

> If a model can do a task 95% of the time but doesn't say when it's in the 5%, it can't automate that task.

Every Choice and Score answer comes with a confidence between 0 and 1, derived from how peaked the probabilities are.
The docs suggest three paths: act on high confidence, confirm on medium, hand off on low.
And the threshold should follow the stakes, not be one number for the whole system:

```ts
const { answers } = await client.systemOne({
  state: userMessage,
  questions: {
    action: choice("What is the user trying to do?", {
      check_balance: "View account balance",
      approve_transfer: "Approve the pending withdrawal request",
      support: "Get help with an issue",
    }),
  },
});

const { action } = answers;

if (action.confidence < 0.5) {
  routeToHuman(userMessage); // genuinely unsure, don't guess
} else if (action.choice === "check_balance") {
  showBalance(accountId); // low stakes, a wrong screen is recoverable
} else if (action.choice === "approve_transfer") {
  if (action.confidence > 0.9) {
    confirmThenExecute(accountId); // high stakes, high confidence
  } else {
    askUserToConfirm(accountId); // high stakes, verify first
  }
}
```

You can ask an LLM for a confidence score too, but you get a number it wrote, not a number it measured.
That difference is what lets you put a model somewhere nobody is watching.

## The workflow benchmark

This is the part I spent the most time on, because the headline on their homepage is "193.6x faster, 444.6x cheaper" and that is the kind of number that deserves a closer look.

### How they test

TypeSafe built a new kind of eval for AI inside code.
They take a written business policy and turn it into a workflow: every sentence becomes either a narrow question for the model (a Noul, Choice, or Score) or a rule in code.
Every model gets the exact same workflow.
The reference answers are the average of two of the largest and most expensive models available, GPT-6 Astra and Claude Fable 5.1, both at high thinking.
So "accuracy" here means agreement with those two models, not with human labels.

There are four published workflows:

- **Security incidents.** An alert fires on a machine. Close it, pass it to an analyst, or contain it now.
- **Agent trace observability.** A support agent finished a run. Does a person need to look at it, and how soon?
- **Invoice processing.** A bill arrives with the order and the delivery record. Pay, hold, or send back.
- **Customer service.** A customer writes in. What should the assistant say and do next?

### The results

Averaged across the four, with every model running the same workflow:

![Scatter chart of mean accuracy against cost per case on a log scale. Jev sits far to the left at 67.8% and $0.0004. Sonnet 5 matches its 67.8% at $0.1174. Sol at 74.1% and Opus 5 at 73.1% are the most accurate, at $0.0836 and $0.1761.](/assets/images/blog/jev-system-one-model/benchmark-frontier.png)

| Model | Accuracy | Cost per case | Time per case |
| --- | --- | --- | --- |
| **Jev** | **67.8%** | **$0.0004** | **0.4 s** |
| Sol (OpenAI) | 74.1% | $0.0836 | 23.3 s |
| Opus 5 (Anthropic) | 73.1% | $0.1761 | 37.8 s |
| Terra (OpenAI) | 67.9% | $0.0304 | 10.1 s |
| Sonnet 5 (Anthropic) | 67.8% | $0.1174 | 78.1 s |
| Luna (OpenAI) | 66.8% | $0.0033 | 12.9 s |
| DeepSeek V4 Pro | 65.5% | $0.0413 | 86.5 s |
| DeepSeek V4 Flash | 64.4% | $0.0059 | 51.9 s |
| Haiku 4.5 (Anthropic) | 53.6% | $0.0195 | 12.5 s |

A few things stand out.

**Jev is not the most accurate model here.**
Sol and Opus 5 agree with the reference about 5 to 6 points more often.
What Jev does is sit at the same level as Sonnet 5 and Terra, at a tiny fraction of the cost and time.

**The size of the gap depends on who you compare against.**
Against Sonnet 5 at the same accuracy, Jev is roughly 290x cheaper and 195x faster per case.
Against Terra, it is roughly 75x cheaper and 25x faster.
Against Luna, the cheapest model in the same accuracy range, it is roughly 8x cheaper and 30x faster.
All real gains, but closer to one or two orders of magnitude than the homepage suggests.
TypeSafe says as much themselves: they expect their headline numbers "are on the higher end of real world gains."

**It is not even across tasks.**

![Paired bars for each workflow comparing Jev with the best LLM. Customer service: Jev 76.0%, Sol 78.3%. Agent trace observability: Jev 71.6%, Sol 76.6%. Security incidents: Jev 61.7%, Opus 5 66.2%. Invoice processing: Jev 61.8%, Sol 79.1%.](/assets/images/blog/jev-system-one-model/per-workflow.png)

On customer service, Jev is within about 2 points of the best model.
On invoice processing, it is about 17 points behind.
Matching an invoice against an order and a delivery record looks like the kind of careful cross-checking that still wants a slower model.
A snap judgment on a customer message does not.

### The finding that applies to every model

The eval also ran every LLM a second way: the same policy pasted in as one big prompt, no workflow.
Every model did better in the workflow, and was cheaper and faster doing it.
Haiku 4.5 went from 18.1% as a prompt to 53.6% as a workflow.
Opus 5 went from 64.8% to 73.1% while costing about half as much.

That holds whether or not you ever use Jev.
Breaking a decision into narrow questions and letting code do the logic beats asking any model to do it all in one shot.

### Read the fine print

TypeSafe is unusually upfront about the limits of their own evidence, and it is worth repeating:

- These are vendor-run evals, and the workflows were written by people on TypeSafe's model team. They say the tasks were not picked to flatter Jev and are not in its training data, but bias could exist.
- The reference labels come from OpenAI and Anthropic models, which they note likely favors those providers.
- Speed was measured from their laptops on the US West Coast, where the service runs. From Dhaka, add the round trip.
- They cannot yet prove the pricing is not subsidized, and say time will have to show that.
- The "0% hallucination" claim is about type errors, and it is true by construction, not measured. Jev cannot return a value outside your schema. It can still return the wrong value.

## When to reach for Jev

- **Smart `if` statements.** Classify, route, score, extract, or branch where hand-written rules are too brittle.
- **Guardrails and verification.** Score or flag LLM outputs, reasoning traces, or prompts, including jailbreak detection, for a fraction of what a second LLM pass costs.
- **Running over a lot of data.** Tagging a million rows is a different conversation at $0.0004 a case than at $0.10.
- **Real time.** At 70 to 500 ms, a model call can sit inside a UI interaction or a game loop. Their Doom demo makes about 10 decisions a second for roughly $7 an hour.

## When to stay with an LLM

- **The output is text.** Chat, drafts, summaries, code. Jev gives all of that up by design.
- **The task needs real reasoning.** Multi-step work, or cross-checking several documents, like the invoice workflow above.
- **You cannot list the options.** Jev handles up to 255 choices directly, and splits larger sets into a two-stage score-then-choose step. Open-ended answers are not its shape.
- **Big inputs.** The Cloudflare listing shows a 32,000 token context window.

Most real systems will use both.
The LLM talks to the person.
Jev makes the calls in the code around it.

At work I built a chat agent that quotes prices, books pickups, and captures leads.
The conversation is an LLM's job.
But the questions behind it, like "is this person asking to book?", "is this a complaint?", or "does this need a human?", are exactly the one-second judgments Jev is built for.
That is where I would try it first.

## The short rule I use

When I am wiring an AI step into code, I ask one question.
_Do I need a sentence, or a decision?_

A sentence is an LLM.
A decision is a System One Model.

Jev is in early access through the [TypeSafe console](https://console.typesafe.ai/), and it is also listed on [Cloudflare's model catalog](https://developers.cloudflare.com/ai/models/typesafe/jev/).
If you have tried it and your numbers look different from theirs, I would love to hear about it.
The fastest ways to reach me are on the [contact page](/contact).
