A commenter asked for “facts, not notes,” so here is a fuller account of the methodology behind our Redis dissolution work.

The basic idea is straightforward: we are taking a large, general-purpose program and reducing it toward the much narrower reality of the appliance that actually runs it. The appliance is `patchworks-v2`, a FreeBSD Redis system whose intended use is limited. In practice, it relies on Redis **streams**, **ACLs**, and **persistence**, and little else. That observation led to a simple question: how much of Redis is present in the binary, but absent from the life of the system?

Our first answer came from coverage. Instrumenting the appliance workload with `gcov` showed that only **14.9%** of Redis’s executable code was being exercised. Put differently, **85.1%** of the codebase was present but idle relative to the appliance’s mission. That does not automatically mean all of that code can be removed, but it does mean the default assumption should be re-examined. In a specialized system, unused generality is not neutral. It enlarges the audit surface, increases interpretive burden, and preserves latent behavior that the system does not need.

From that starting point we developed a procedure we call **DDD.1: Demolition-Driven Development, Procedure 1**.

## 1. DDD.1: a method for proving removal

The central difficulty in code removal is epistemic. It is easy to believe something has been removed when it has only been disabled, or partially bypassed, or left reachable through a path one failed to inspect. We wanted a method that makes removal demonstrable.

For each subsystem selected for excision, we follow the same steps:

1. **Write tests that exercise the subsystem to near-complete coverage.**  
   Before removing a feature, we first establish that we can drive it deliberately and observe its behavior comprehensively.

2. **Verify those tests pass.**  
   This confirms both that the feature exists and that the test harness is meaningful.

3. **Excise the subsystem.**  
   During transitional phases this may involve replacing functionality with stubs that return errors. In later phases, the code and dispatch entries are removed entirely.

4. **Verify the tests now XFAIL.**  
   This is an important constraint. The tests should not merely stop being relevant; they should fail in a controlled, expected way. Their failure becomes evidence that the feature no longer exists.

5. **Trace residual coverage on a per-test basis.**  
   Each XFAIL test is then run individually under `gcov`. The executed lines should collapse to a common infrastructure floor—about **4,897 lines** in our case—with no residual module-specific execution above that floor. The uniformity of that residual is one of the strongest signs that the subsystem has actually been removed rather than incompletely bypassed.

The point of DDD.1 is not only to test what remains. It is to test what has been deliberately made impossible.

## 2. Lua as the initial precedent

Lua was the first major target because it offered a clear security justification. Redis’s embedded Lua subsystem has accumulated **six CVEs in four years**, including a **13-year-old CVSS 10.0 use-after-free**. For an appliance that does not need scripting, the natural question is whether “disable scripting” is enough. Our answer was no. Configuration-based denial still leaves the code present. A stronger approach is to ensure that the scripting machinery is absent from the binary altogether.

That is what we did.

The resulting executable does not contain symbols such as `luaL_newstate`. `EVAL` fails because the implementation is not compiled in, not because a runtime setting refuses to invoke it. This distinction matters. Configuration can be changed, misread, or circumvented. Code that is absent has a different ontological status: it is not waiting to be re-enabled.

Lua provided the methodological precedent for the rest of the work. The goal was not to administratively prohibit unused capabilities, but to remove them from the program itself.

## 3. Systematic module excision

From there we moved through additional Redis subsystems that the appliance does not require. Among the removals:

- **Geo** — 1,584 lines, 43 tests
- **Bit operations** — 1,267 lines, 30 tests
- **Sort** — 316 lines, 10 tests
- **LOLWUT** — 566 lines, 5 tests
- **Sentinel** — 5,484 lines, 6 tests
- **String type** — 951 lines, 30 tests
- **Cluster** — 3,649 lines, 8 tests
- **Debug** — 2,160 lines, 10 tests

Each excision was committed separately. This is partly practical—`git bisect` remains useful—but also methodological. It preserves a record of removal as a sequence of legible acts rather than a single aggregate transformation.

A further principle guided this stage: when a feature is removed, its **command table entries** should be removed as well. A command that still exists in the dispatch table but returns an error remains part of the system’s expressed surface. We preferred excised commands to become genuinely unknown commands. That makes the boundary clearer both operationally and conceptually.

## 4. Command-table dissolution

A substantial part of Redis’s surface is defined through command metadata. Once we began removing that metadata, the structure of the program started changing in a more consequential way.

We moved **218 command JSON files** into an `excised/` directory. The generated command table shrank by **63%**.

That reduction exposed dependencies that had previously seemed structurally necessary. Once the command definitions were removed:

- handler stubs became orphaned,
- dead function-pointer comparisons became visible,
- branches that were once justified by dispatch possibilities became eliminable.

The work often proceeded in a sequence like this:

**remove command JSON → orphan handler → remove handler → simplify branch → reveal further deadness**

This recursive quality is worth emphasizing. In a large codebase, much of what appears essential is only essential relative to other structures that are themselves contingent. Removing the outer declaration can expose the inner machinery as unnecessary.

## 5. Differential dead-code analysis

The most useful methodological refinement came in the form of a differential analysis.

If one runs a dead-code detector on a mature codebase such as Redis, the result includes many longstanding false positives and ambiguous cases. That makes it difficult to identify deadness introduced specifically by our own removals.

The solution was comparative:

1. run lexical dead-code analysis on the **original** source tree,
2. run the same analysis on the **current dissolved** tree,
3. investigate only the findings that are **unique to the current tree**.

This removes much of the background noise. The original tree functions as a control.

We also used `nm` to identify functions that were still defined in object files but no longer referenced in the ways that matter. A conceptual correction was important here. A function may remain declared in a header and thus remain formally part of the compilable interface, but that does not mean it is operationally reachable. Only actual call sites in `.c` files count as evidence of use in this context. Header declarations are possibilities; call sites are commitments.

Using this approach we identified **166 newly dead functions**. These were not primarily user-facing command handlers. They were intermediate plumbing functions—code whose role had been to connect command dispatch to subsystems that had already been stubbed out or made unreachable.

We removed all 166. The binary still built cleanly, and the test suite still passed.

That result gave us confidence that the differential method was discovering real structural consequences of prior excisions rather than merely generating speculative cleanup opportunities.

## 6. What static reachability misses

An interesting negative result concerns linker-based dead stripping.

We tried `--gc-sections` and found that it removed **0 bytes**, even in circumstances where we knew there was code that no longer mattered to the appliance. The reason is that much of this code remains **statically reachable**. Some compilation unit still calls it, so the linker correctly retains it.

But there is an important difference between static reachability and dynamic necessity.

A function can remain statically connected to the program graph while being dynamically inert because the states that would lead to it no longer arise. For example, persistence or append-only code may retain logic for data types that our appliance never instantiates. From the linker’s perspective, the call graph still exists. From the appliance’s perspective, the behavior no longer occurs.

This is why `gcov` is so useful here. For our purposes, dynamic execution under the real operational envelope is more informative than abstract graph reachability. The linker tells us what *could* be entered under some admissible path in the compiled program. Coverage tells us what *does* get entered under the intended life of the appliance.

In a general-purpose product, static reachability may be the appropriate standard. In a specialized appliance, dynamic non-occurrence can be the more meaningful truth.

## 7. Current state

At the current stage of the work, the system stands as follows:

- **39,682 executable lines** remain  
  (down from 57,753; a **31.3% reduction**)

- **23.5% coverage**  
  (up from 14.9%)

- **10.95 MB binary size**  
  (down from 13.8 MB)

- **142 DDD.1 XFAIL tests**  
  documenting specific removals as explicit non-capabilities

- The remaining validation suites pass:
  - **59 operational tests**
  - **42 end-to-end tests**
  - **157 fuzz tests**

So the result is not simply “less code.” It is a smaller executable paired with a more articulate description of what the appliance is and is not.

## 8. Philosophical orientation

There is a broader systems point here.

Large software projects often carry an implicit metaphysics of retention: if code exists, and if it is not currently causing trouble, then its continued presence is treated as harmless or even prudent. But in a specialized system, unused capability is not merely dormant possibility. It is a standing claim on interpretation, testing, and trust.

The aim of this work is therefore not only optimization and not only hardening. It is clarification.

A specialized appliance should increasingly resemble its purpose. That means not only that the right code remains, but that code unrelated to the appliance’s life is progressively removed. The program becomes less a warehouse of optional futures and more an expression of the actual task it is meant to perform.

## 9. What comes next

Three next steps are currently in view.

### Syscall fault injection
We want to deliberately induce failures in the syscall paths of the Redis functionality we still depend on. That should reveal which error-handling and recovery paths remain essential and therefore must be preserved carefully.

### Strace signature stability
We plan to treat syscall traces as regression artifacts. If the appliance’s syscall signature shifts unexpectedly, that may indicate that new behavior or previously dissolved behavior has re-entered the system.

### Line-level mutation analysis
Coverage tells us what runs. Mutation analysis tells us whether our tests would detect wrong behavior in the code that still matters. We want to apply this at the line level within the Redis C modules the appliance continues to rely on.

## 10. Summary

The method can be summarized simply:

- determine what the appliance actually uses,
- construct tests that make those boundaries explicit,
- remove what lies outside them,
- and require proof that the removal is real.

For us, that has meant moving from “Redis with many disabled features” toward “a smaller Redis-shaped program whose remaining behavior is closer to the appliance’s actual purpose.”

That is the methodological core of the dissolution work.
