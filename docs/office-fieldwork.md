# Office construction crew

Employees assigned to a project named `Office` use a temporary construction
routine when their current task names one unambiguous ship area. Other employees
and tasks without a clear area keep the existing desk behavior.

Room names and common English/Chinese aliases are recognized, including
rainforest/雨林, bar/吧台, server room/机房 and cloning/克隆舱. Multiple possible
areas fall back to the desk. Public rooms prefer the employee's home deck; `L2`,
`deck 2` and `二层` can select another deck. Short continuation messages keep the
preceding substantive task.

On arrival, the employee sets down a tool case, cones and a folding blueprint
table, then puts on an orange reflective uniform, hard hat and boots. The routine
alternates blueprint study, notebook writing, measuring, looking around and short
inspection walks. Saved character appearance is never changed. Waiting for user
input keeps the site occupied. Completion, error or an unlocated replacement
task packs up the camp and returns the employee to their desk.

Movement uses the existing collision-aware ring/spoke paths. Cross-deck trips
enter the central lift before changing height. Scene state survives ordinary
roster refreshes, and characters continue their routine off camera.

The browser observes the existing selected-session stream. On work-status or
connection changes it reads at most three history pages per active Office
employee; it does not poll task history on animation frames or metadata refreshes.
Unreadable or unresolved task context keeps normal desk behavior. This feature
animates existing tasks; it does not create, delegate or modify agent jobs.
