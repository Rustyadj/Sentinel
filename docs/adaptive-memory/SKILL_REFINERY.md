# Skill Refinery

Pipeline: significant runs -> generalized candidate -> security scan -> replay
fixtures -> baseline comparison -> human review -> canonical skill plus immutable
version -> outcome monitoring -> rollback.

Promotion requires at least two source runs, at least two passing replay
fixtures, no unresolved security findings, and improvement over a recorded
baseline when one exists. Write-capable skills require rollback steps. Imported
or agent-authored skills never activate automatically.

Rollback retires the active `SkillVersion`, reactivates the prior version when
available, and emits an auditable event. A first version with no predecessor is
marked rolled back rather than silently deleted.
