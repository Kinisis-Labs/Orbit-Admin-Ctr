---
name: executeSql sandbox behavior
description: How the code_execution executeSql callback reports SQL errors.
---

# executeSql (code_execution sandbox) error reporting

`executeSql({ sqlQuery })` resolves with
`{ success: boolean, output: string, exitCode, exitReason }`. On a SQL error it
returns `{ success: false, output: "...ERROR: ...", exitCode: 1 }` — it does
**NOT throw**. A `try/catch` around it will never catch a SQL failure.

**How to apply:** to assert a query failed (e.g. proving a CHECK/UNIQUE
constraint rejects bad data), check `r.success === false` and inspect
`r.output`, not a thrown exception. To confirm a write's effect, query the row
count afterward rather than trusting the absence of an error.
