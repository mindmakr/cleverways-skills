#!/usr/bin/env node
// Sets up one GitHub Project (v2) across a product's repos: Status workflow, fields, sprints,
// views, the open issues, and a release-notes config PR per repo. Re-running is safe: it adds
// what is missing and never overwrites a value somebody has set on the board, except the
// releases named with --assign-release.
//
// Milestones are left to the planning skills (one per epic). Releases are a "Release" field.
//
// Usage: node setup.mjs --owner O --title T --repo NAME=PLATFORM [--repo …] [options] [--dry]
//   --release NAME             a Release option, e.g. v1.0.0; repeatable, in order
//   --assign-release REL=REFS  set Release on issues, REFS = repo#12,repo#13; repeatable
//   --sprint-start YYYY-MM-DD  first sprint's start; omit for kanban (no Sprint field)
//   --sprint-days N            default 14
//   --sprints N                default 4
//   --sprint-priorities LIST   e.g. High,Medium: newly added issues with these go into Sprint 1 as Ready
//   --release-config BASE      open a PR per repo adding .github/release.yml, based on BASE
//   --dry                      print the plan, change nothing

import { execFileSync, spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = { repo: [], release: [], 'assign-release': [], 'sprint-days': '14', sprints: '4' };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (k === 'dry') { opt.dry = true; continue; }
  const v = argv[++i];
  if (Array.isArray(opt[k])) opt[k].push(v); else opt[k] = v;
}
if (!opt.owner || !opt.title || !opt.repo.length) {
  console.error('Usage: setup.mjs --owner O --title T --repo NAME=PLATFORM [--repo …] [--release v1.0.0] [--sprint-start YYYY-MM-DD] [--dry]');
  process.exit(2);
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1 << 26 }).trim();
const json = (args, input) => JSON.parse(gh(args, input) || 'null');
const ok = (args) => spawnSync('gh', args, { encoding: 'utf8' }).status === 0;
const gql = (query) => json(['api', 'graphql', '-f', `query=${query}`]).data;
const plan = (s) => console.log(`  + ${s}`);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const { owner, title } = opt;
const repos = opt.repo.map((r) => { const [name, platform] = r.split('='); return { name, platform, full: `${owner}/${name}` }; });
const platforms = [...new Set(repos.map((r) => r.platform))];
const sprintDays = Number(opt['sprint-days']);

// Preflight.
const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
if (!/'project'/.test(auth.stdout + auth.stderr)) {
  console.log("The gh token lacks the 'project' scope. Ask the user to run:\n  ! gh auth refresh -h github.com -s project");
  process.exit(3);
}
const orgOwned = json(['api', `users/${owner}`]).type === 'Organization';
const REST = `${orgOwned ? 'orgs' : 'users'}/${owner}`;

// Current state.
let project = json(['project', 'list', '--owner', owner, '--limit', '200', '--format', 'json']).projects.find((p) => p.title === title);
const isNew = !project;
let fields = [], views = new Set(), linked = new Set(), onBoard = new Map();
const readFields = () => json(['project', 'field-list', String(project.number), '--owner', owner, '--limit', '100', '--format', 'json']).fields;
if (!isNew) {
  fields = readFields();
  const n = gql(`{node(id:"${project.id}"){... on ProjectV2{views(first:50){nodes{name}} repositories(first:50){nodes{name}}}}}`).node;
  views = new Set(n.views.nodes.map((v) => v.name));
  linked = new Set(n.repositories.nodes.map((r) => r.name));
  for (const it of json(['project', 'item-list', String(project.number), '--owner', owner, '--limit', '2000', '--format', 'json']).items)
    if (it.content?.url) onBoard.set(it.content.url, it.id);
}
const field = (name) => fields.find((f) => f.name === name);

const wantFields = ['Platform', 'Priority', 'Size', 'Start', 'Target', 'Pull request', 'Fixes', ...(opt.release.length ? ['Release'] : []), ...(opt['sprint-start'] ? ['Sprint'] : [])];
const boardView = opt['sprint-start'] ? 'Scrum board · current sprint' : 'Kanban board';
const wantViews = [boardView, 'Backlog', 'Roadmap', 'Release notes', 'Bug triage', 'Pull requests'];
const missingReleases = opt.release.filter((r) => field('Release') && !field('Release').options.some((o) => o.name === r));

const newIssues = [];
for (const r of repos)
  for (const i of json(['issue', 'list', '-R', r.full, '-s', 'open', '-L', '1000', '--json', 'url,labels']))
    if (!onBoard.has(i.url)) newIssues.push({ url: i.url, platform: r.platform, labels: i.labels.map((l) => l.name) });

const releaseConfigPRs = [];
if (opt['release-config'])
  for (const r of repos) {
    if (ok(['api', `repos/${r.full}/contents/.github/release.yml?ref=${opt['release-config']}`, '--silent'])) continue;
    const open = json(['pr', 'list', '-R', r.full, '--head', 'chore/release-notes-config', '--state', 'open', '--json', 'url']);
    if (open.length) console.log(`  = release.yml PR already open: ${open[0].url}`); else releaseConfigPRs.push(r);
  }

console.log(`Owner: ${owner} (${orgOwned ? 'org' : 'user'})   Project: ${title}${isNew ? '' : ` (#${project.number})`}\nPlan:`);
if (isNew) plan(`create project "${title}" and set its Status options`);
for (const f of wantFields) if (!field(f)) plan(`field ${f}`);
for (const r of missingReleases) console.log(`  ! Release "${r}" is not an option yet. Add it in the UI (Release field → Edit): replacing options by API clears every item's Release.`);
for (const r of repos) if (!linked.has(r.name)) plan(`link repo ${r.full}`);
for (const v of wantViews) if (!views.has(v)) plan(`view "${v}"`);
if (newIssues.length) plan(`add ${newIssues.length} open issue(s) to the board`);
for (const a of opt['assign-release']) plan(`Release ${a}`);
for (const r of releaseConfigPRs) plan(`PR adding .github/release.yml to ${r.name} (base ${opt['release-config']})`);
if (opt.dry) { console.log('(dry run: nothing changed)'); process.exit(0); }

// Project and Status. Replacing Status options clears every item's Status, so only on a new project.
if (isNew) {
  project = json(['project', 'create', '--owner', owner, '--title', title, '--format', 'json']);
  fields = readFields();
  const status = [
    ['Backlog', 'GRAY', 'Not yet ready to pick up'], ['Ready', 'BLUE', 'Understood and sized; can start'],
    ['In progress', 'YELLOW', 'Someone is working on it'], ['In review', 'PURPLE', 'Pull request open'],
    ['Ready to merge', 'PINK', 'Review passed; waiting for someone to merge'],
    ['On test', 'ORANGE', 'Merged; awaiting verification'], ['Done', 'GREEN', 'Verified'],
  ].map(([name, color, description]) => `{name:"${name}",color:${color},description:"${description}"}`).join(',');
  gql(`mutation{updateProjectV2Field(input:{fieldId:"${field('Status').id}",singleSelectOptions:[${status}]}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}`);
  console.log(`Created project #${project.number}`);
}
const num = String(project.number);

const select = (name, options) => {
  gh(['project', 'field-create', num, '--owner', owner, '--name', name, '--data-type', 'SINGLE_SELECT', '--single-select-options', options.join(',')]);
  console.log(`Field ${name}`);
};
if (!field('Platform')) select('Platform', platforms);
if (!field('Priority')) select('Priority', ['High', 'Medium', 'Low']);
if (!field('Size')) select('Size', ['XS', 'S', 'M', 'L', 'XL']);
if (opt.release.length && !field('Release')) select('Release', opt.release);
for (const d of ['Start', 'Target'])
  if (!field(d)) { gh(['project', 'field-create', num, '--owner', owner, '--name', d, '--data-type', 'DATE']); console.log(`Field ${d}`); }
// Written by board.mjs sync: the PRs that name an issue, and the issues a PR names.
for (const t of ['Pull request', 'Fixes'])
  if (!field(t)) { gh(['project', 'field-create', num, '--owner', owner, '--name', t, '--data-type', 'TEXT']); console.log(`Field ${t}`); }
if (opt['sprint-start'] && !field('Sprint')) {
  const start = opt['sprint-start'];
  const its = Array.from({ length: Number(opt.sprints) }, (_, i) => `{title:"Sprint ${i + 1}",startDate:"${addDays(start, i * sprintDays)}",duration:${sprintDays}}`).join(',');
  gql(`mutation{createProjectV2Field(input:{projectId:"${project.id}",dataType:ITERATION,name:"Sprint",iterationConfiguration:{startDate:"${start}",duration:${sprintDays},iterations:[${its}]}}){projectV2Field{... on ProjectV2IterationField{id}}}}`);
  console.log(`Field Sprint (${opt.sprints} × ${sprintDays} days from ${start})`);
}
for (const r of repos) if (!linked.has(r.name)) { gh(['project', 'link', num, '--owner', owner, '--repo', r.full]); console.log(`Linked ${r.name}`); }

// Field and option ids, by name.
fields = readFields();
const iterations = gql(`{node(id:"${project.id}"){... on ProjectV2{field(name:"Sprint"){... on ProjectV2IterationField{configuration{iterations{title id startDate}}}}}}}`).node.field?.configuration.iterations ?? [];
const setOption = (item, name, value) => {
  const f = field(name), o = f?.options?.find((x) => x.name === value);
  if (o) gh(['project', 'item-edit', '--project-id', project.id, '--id', item, '--field-id', f.id, '--single-select-option-id', o.id]);
  return Boolean(o);
};
const priorityOf = (labels) => {
  const l = labels.map((x) => x.toLowerCase());
  const has = (...keys) => l.some((x) => keys.some((k) => x === k || x.includes(`priority: ${k}`) || x.includes(`priority/${k}`)));
  if (l.some((x) => x.includes('critical')) || has('high', 'p0', 'p1')) return 'High';
  if (has('medium', 'p2')) return 'Medium';
  if (has('low', 'p3')) return 'Low';
  return null;
};
const sprintPriorities = (opt['sprint-priorities'] ?? '').split(',').filter(Boolean);
for (const i of newIssues) {
  const id = json(['project', 'item-add', num, '--owner', owner, '--url', i.url, '--format', 'json']).id;
  onBoard.set(i.url, id);
  const pr = priorityOf(i.labels);
  setOption(id, 'Platform', i.platform);
  if (pr) setOption(id, 'Priority', pr);
  let where = 'Backlog';
  if (pr && iterations[0] && sprintPriorities.includes(pr)) {
    setOption(id, 'Status', 'Ready');
    gh(['project', 'item-edit', '--project-id', project.id, '--id', id, '--field-id', field('Sprint').id, '--iteration-id', iterations[0].id]);
    where = `Ready, ${iterations[0].title}`;
  } else setOption(id, 'Status', 'Backlog');
  console.log(`Added ${i.url.replace('https://github.com/', '')}  ${i.platform}  ${pr ?? 'no priority'}  ${where}`);
}

for (const a of opt['assign-release']) {
  const [rel, refs] = a.split('=');
  for (const ref of refs.split(',')) {
    const [repo, n] = ref.trim().split('#');
    const url = `https://github.com/${owner}/${repo}/issues/${n}`;
    const id = onBoard.get(url) ?? json(['project', 'item-add', num, '--owner', owner, '--url', url, '--format', 'json']).id;
    console.log(setOption(id, 'Release', rel) ? `Release ${rel}: ${repo}#${n}` : `  ! Release "${rel}" is not an option; ${repo}#${n} left unset`);
  }
}

// Views. The REST API creates views but cannot edit or delete them, so each spec must be right
// before it is sent. On a board, vertical_group_by is the columns and group_by the swimlanes.
const nid = Object.fromEntries(json(['api', '--paginate', '--slurp', `${REST}/projectsV2/${num}/fields`]).flat().map((f) => [f.name, f.id]));
const ids = (...names) => names.filter((n) => nid[n]).map((n) => nid[n]);
const specs = [
  { name: boardView, layout: 'board', filter: opt['sprint-start'] ? 'sprint:@current' : '-status:Done',
    visible_fields: ids('Title', 'Priority', 'Platform', 'Size', 'Assignees', 'Pull request'), vertical_group_by: ids('Status'), group_by: ids('Platform') },
  { name: 'Backlog', layout: 'table', filter: 'is:issue -status:Done',
    visible_fields: ids('Title', 'Status', 'Priority', 'Platform', 'Size', 'Sprint', 'Release', 'Milestone', 'Assignees', 'Pull request'),
    group_by: ids(nid.Release ? 'Release' : 'Milestone'), sort_by: [[nid.Priority, 'asc']] },
  { name: 'Roadmap', layout: 'roadmap', filter: 'is:issue -status:Done', visible_fields: ids('Title', 'Status', 'Release'), group_by: ids('Milestone') },
  { name: 'Release notes', layout: 'table', filter: 'is:issue status:"On test",Done',
    visible_fields: ids('Title', 'Repository', 'Platform', 'Labels', 'Pull request', 'Status'), group_by: ids(nid.Release ? 'Release' : 'Milestone') },
  { name: 'Pull requests', layout: 'table', filter: 'is:pr -status:Done',
    visible_fields: ids('Title', 'Repository', 'Fixes', 'Reviewers', 'Assignees', 'Status', 'Labels'), group_by: ids('Repository') },
  { name: 'Bug triage', layout: 'table', filter: 'is:issue label:bug is:open',
    visible_fields: ids('Title', 'Priority', 'Platform', 'Status', 'Sprint', 'Release', 'Assignees', 'Labels'), group_by: ids('Priority'), sort_by: [[nid.Platform, 'asc']] },
];
for (const s of specs)
  if (!views.has(s.name)) console.log(`View ${s.name}: ${json(['api', '-X', 'POST', `${REST}/projectsV2/${num}/views`, '--input', '-'], JSON.stringify(s)).html_url}`);

// Release-notes config.
const RELEASE_YML = `# Categories for GitHub's "Generate release notes" button.
# A pull request lands in the first category whose label it carries.
changelog:
  exclude:
    labels: [duplicate, invalid, wontfix]
  categories:
    - title: Security
      labels: [security]
    - title: New and changed
      labels: [enhancement, feature]
    - title: Fixes
      labels: [bug]
    - title: Documentation
      labels: [documentation]
    - title: Other changes
      labels: ["*"]
`;
const branch = 'chore/release-notes-config';
for (const r of releaseConfigPRs) {
  const base = opt['release-config'];
  if (!ok(['api', `repos/${r.full}/branches/${branch}`, '--silent'])) {
    const sha = json(['api', `repos/${r.full}/branches/${base}`]).commit.sha;
    gh(['api', `repos/${r.full}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`, '--silent']);
    gh(['api', '-X', 'PUT', `repos/${r.full}/contents/.github/release.yml`, '-f', 'message=Release notes: group generated notes by label',
      '-f', `content=${Buffer.from(RELEASE_YML).toString('base64')}`, '-f', `branch=${branch}`, '--silent']);
  }
  console.log(gh(['pr', 'create', '-R', r.full, '--base', base, '--head', branch, '--title', 'Release notes: group generated notes by label', '--body',
    '`.github/release.yml`: **Generate release notes** on a GitHub release now sorts merged pull requests into Security, New and changed, Fixes, Documentation and Other, by label. Configuration only.']));
}

console.log(`Done: https://github.com/${REST}/projects/${num}`);
if (iterations[0] && Date.parse(`${iterations[0].startDate}T00:00:00Z`) > Date.now())
  console.log(`Note: ${iterations[0].title} has not started, so "${boardView}" (sprint:@current) is empty until it does.`);
