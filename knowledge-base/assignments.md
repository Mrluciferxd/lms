# Assignments & Grading

## What this subsystem does
Assignments scoped to a course or batch, student submissions with an explicit
submit gesture, and a staff grading queue with score + feedback + return-for-
resubmit. The lifecycle is a small explicit state machine
(`DRAFT → SUBMITTED → GRADED`, plus `RESUBMIT_REQUESTED`), and every transition
re-checks auth + scope + roster on the server — the same "server action is an
endpoint" posture as chat.

## How it is structured
| File | Responsibility |
|---|---|
| `src/server/assignments/access.ts` | **Pure** `decideAssignmentVisibility`, `decideCanSubmit`, `decideCanGrade` + `loadAssignmentViewer` |
| `src/server/assignments/validation.ts` | **Pure** assignment / submission / grade field rules, `isScoreInRange` |
| `src/server/assignments/assignments.ts` | DB reads: list for viewer, list for staff, single, own submission, grading queue, counts |
| `src/server/assignments/actions.ts` | `'use server'` writes: create / update / set status / delete / save submission / grade / reopen |
| `src/server/assignments/access.test.ts` | Visibility matrix, submit lifecycle + late-policy boundaries, grade role matrix |
| `src/server/assignments/validation.test.ts` | Field bounds for assignment, submission, grade |
| `src/app/app/assignments/page.tsx` | Student list: open / due / graded sections with status badges |
| `src/app/app/assignments/[id]/page.tsx` | Student detail + submission composer |
| `src/components/assignments/submission-composer.tsx` | Client component: save draft / submit via `saveSubmission` |
| `src/app/admin/assignments/page.tsx` | Admin overview: list, counts, create form, publish/archive |
| `src/app/admin/assignments/[id]/page.tsx` | Grading queue: per-submission grade + return-for-resubmit |
| `src/components/assignments/grading-form.tsx` | Client component: score + feedback via `gradeSubmission` / `reopenSubmission` |

## Conventions and rules
- **Scope is course or batch, never everyone.** An assignment with neither
  `courseId` nor `batchId` has no audience — students get `NO_SCOPE` and staff
  bypass. Publishing such an assignment is refused by `setAssignmentStatus`
  with a reason, so an admin cannot publish to nobody.
- **Lifecycle first, roster second.** `decideCanSubmit` answers from the
  submission row's state (`GRADED` needs the grader to reopen, `SUBMITTED` is
  held by the grader) before the roster check — a submission row survives an
  enrollment lapse, but a *new* submission re-checks the roster.
- **Late policy is decided at submit time, not render time.** `dueAt` is a
  moment a viewer crosses naturally; the decision function takes `now` and the
  form can be stale by the time Submit is clicked. `allowLateSubmission` is
  per-assignment.
- **The grader cannot grade their own work.** `decideCanGrade` refuses when
  `submission.userId === viewer.id` — grading the self would defeat the role
  split the matrix is built around.
- **No self-submitted score.** `reopenSubmission` (an alias for
  `gradeSubmission({ returnForResubmit: true })`) is the grader's gate back to
  the student; a student cannot move a `GRADED` row, and `saveSubmission`
  refuses to overwrite one.
- **Delete refuses submissions.** An assignment with any submission row must be
  archived, not deleted — the grading history is the kind of thing a delete
  destroys.
- **Scores are integers.** `isScoreInRange` and `validateGrade` enforce
  whole-number scores between 0 and the row's `maxScore` (ceiling 10,000) —
  the same no-float rule as money.

## The state machine
```
DRAFT ──submit──▶ SUBMITTED ──grade──▶ GRADED
                    │  ▲
      returnForResubmit ──submit── (student re-submits)
                    ▼
            RESUBMIT_REQUESTED
```
`GRADED` is terminal unless the grader reopens it. Draft saves never reach the
grading queue; only `SUBMITTED` (or a `RESUBMIT_REQUESTED` row the student has
re-submitted) appears there for grading.

## Known gotchas
- **Late submissions flip `isLate`.** The flag is written at submit time and
  shown in the queue; a draft overwrite clears it back to false.
- **Save-draft over a SUBMITTED row un-submits it.** A student who clicks
  "Save draft" on a submitted row gets it back to `DRAFT` (and out of the
  queue) before grading starts — that is the literal "I want to revise" action.
- **`gradeSubmission` also regrades.** A `GRADED` row accepted back through
  `gradeSubmission` is the re-grade path; the same action with
  `returnForResubmit` is the reopen path.
- **Grading counts are a groupBy.** `gradingCounts` shapes one `GROUP BY`
  into the per-status buckets for the admin overview; it is read-only and
  duplicated nowhere else.

## How it is tested
- `access.test.ts` — every visibility combination (staff bypass for all four
  staff roles, DRAFT/ARCHIVED denial, PUBLISHED via enrollment/batch/no-scope),
  `decideCanSubmit` across the lifecycle (graded / submitted / draft /
  resubmit-requested / none) with the late boundary at exactly `dueAt`, and the
  `decideCanGrade` role matrix including self-grading refusal.
- `validation.test.ts` — boundary lengths both sides for title, instructions,
  submission text, feedback; maxScore ceiling; attachment caps; `isScoreInRange`
  including the `maxScore <= 0` guard.

## Related
[architecture.md](./architecture.md) · [auth.md](./auth.md) · [chat.md](./chat.md) (same server-action posture and feature-flag gate)
