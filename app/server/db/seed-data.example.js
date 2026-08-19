// Example seed content — the public starting point for any committee.
//
// This file ships with the repository and is what a fresh clone seeds from. It
// has two jobs:
//
//   1. Make the app immediately usable and explorable with no setup, so you can
//      see what every screen is for before writing a single word of your own.
//   2. Act as a template. Every export below shows the exact shape the app
//      expects, so replacing this content with your own is filling in a form
//      rather than reverse-engineering a schema.
//
// ── Making it yours ────────────────────────────────────────────────────────────
// Copy this file to `seed-data.local.js` in the same folder and edit that. The
// loader in `seed-data.js` prefers `seed-data.local.js` whenever it exists, so
// your own prep is picked up automatically. `seed-data.local.js` is gitignored:
// your speeches, POI bank and country research stay on your machine and can
// never be committed, including by accident in a pull request.
//
//   cd app/server/db
//   cp seed-data.example.js seed-data.local.js
//   # edit seed-data.local.js, then restart the app
//
// ── About the content below ───────────────────────────────────────────────────
// The example agenda is climate adaptation finance, chosen because it is a
// common MUN topic and unrelated to whatever you are actually preparing.
//
// Speeches, POIs and answers are written as "our delegation" rather than naming
// a country. That is deliberate: this file must not put positions in the mouth
// of any real state, and neutral phrasing means the examples read correctly
// whichever delegation you are assigned.
//
// The country entries are scaffolding, not research. They show which fields
// exist and are explicitly marked as placeholders. Do not take them into a
// committee — replace them with your own work.
//
// PROCEDURE and UNGA_POWERS are the exception: they are general Model UN
// procedure and factual notes on what the General Assembly can and cannot do.
// They apply to every committee and are worth keeping as-is. Where your
// conference announces a different rule, the Chair always wins.

export const SOURCES = {
  quickbook: 'example-speaking-quickbook.md',
  cheatsheet: 'example-live-cheat-sheet.md',
  dossier: 'example-country-dossier.md',
  rules: 'example-rules-and-procedure.md',
  studypack: 'example-study-pack.md',
  playbook: 'example-caucus-playbook.md',
  resolution: 'example-draft-resolution.md',
}

// ─────────────────────────────────────────────────────────────── speeches
//
// `category` is free-form and drives grouping in the UI. `duration_s` is what
// the on-screen timer counts down. `memory_hook` is the skeleton you glance at
// when you have lost your place mid-speech — keep it to a few arrow-separated
// beats. `pinned: 1` surfaces it on the dashboard.

export const SPEECHES = [
  {
    title: 'Opening — 30 seconds (GSL)',
    category: 'opening', duration_s: 30, ordinal: 0, pinned: 1,
    memory_hook: 'Shared problem → Our priority → Mechanism → Ask',
    tags: ['opening', 'gsl', 'example'],
    body: `Honourable Chair, distinguished delegates, our delegation believes adaptation finance is not charity but shared infrastructure against a shared risk. Commitments have been made repeatedly and met inconsistently. Our delegation therefore focuses on three things: predictable multi-year funding, simplified access for the states most exposed, and honest public reporting of what was actually disbursed. We ask delegates to put those three commitments into the operative text.`,
  },
  {
    title: 'Predictable multi-year funding',
    category: '30s', duration_s: 30, ordinal: 1, pinned: 1,
    memory_hook: 'Annual pledges → cannot plan → multi-year floor',
    tags: ['finance', 'example'],
    body: `A state cannot build a sea wall on an annual pledge. Our delegation supports multi-year funding commitments with a published floor, so that ministries can plan capital projects across budget cycles rather than reapplying every twelve months for money that may not arrive.`,
  },
  {
    title: 'Simplified access',
    category: '30s', duration_s: 30, ordinal: 2,
    memory_hook: 'Money exists → cannot be reached → access is the bottleneck',
    tags: ['access', 'capacity', 'example'],
    body: `The binding constraint is often not the size of the fund but the difficulty of reaching it. Our delegation supports simplified access procedures and direct accreditation for the states with the least administrative capacity, because a fund that cannot be accessed by those who need it most is not really a fund.`,
  },
  {
    title: 'Transparent reporting',
    category: '30s', duration_s: 30, ordinal: 3, pinned: 1,
    memory_hook: 'Pledged ≠ disbursed. Publish both.',
    tags: ['transparency', 'accountability', 'example'],
    body: `Pledged and disbursed are different numbers, and the gap between them is where trust is lost. Our delegation supports standard public reporting of both, on a common format, so that the committee can measure delivery rather than announcements.`,
  },
  {
    title: 'Emergency 20-second formula',
    category: 'emergency', duration_s: 20, ordinal: 4, pinned: 1,
    memory_hook: 'POSITION → REASON → MECHANISM → ASK',
    tags: ['emergency', 'formula'],
    body: `POSITION → REASON → MECHANISM → ASK

The most useful thing in this app is not a speech, it is this shape. Any hostile question can be answered with it:

"Our delegation supports [POSITION], because [REASON]. We therefore support [SPECIFIC MECHANISM]. We ask delegates to [CONCRETE ASK]."

Practise it until it is automatic. It will save you every time you are called on without warning.`,
  },
  {
    title: '10-second reset',
    category: 'emergency', duration_s: 10, ordinal: 5, pinned: 1,
    memory_hook: 'Predictability · Access · Transparency',
    tags: ['reset', 'example'],
    body: `Adaptation finance should be predictable enough to plan against, reachable by the states most exposed, and reported honestly enough to verify.

Predictability — multi-year commitments, not annual announcements.
Access — simplified procedures and direct accreditation.
Transparency — publish pledged and disbursed on a common format.`,
  },
]

// ─────────────────────────────────────────────────────────────────── POIs
//
// `target_country` is an ISO-3166 alpha-2 code, or 'ANY' for a question that
// works against any delegation. `strength` is 'strong' | 'medium' | 'weak' and
// drives ordering. `purpose` is a private note to yourself — it is never spoken.

export const POIS = [
  // The genuinely universal questions. These work in any committee, on any
  // agenda, and are the most useful part of this list. Keep them.
  { target_country: 'ANY', topic: 'Red lines', strength: 'strong', pinned: 1,
    question: 'Which provision is your delegation unwilling to compromise on?',
    purpose: 'The best unmoderated-caucus opener there is. Maps the room in one question.' },
  { target_country: 'ANY', topic: 'Mechanism', strength: 'strong', pinned: 1,
    question: 'Which specific body would carry out what your delegation is proposing?',
    purpose: 'Separates a principle from a mechanism. Many delegations cannot answer it.' },
  { target_country: 'ANY', topic: 'Accountability', strength: 'strong',
    question: 'What happens if a commitment in this resolution is not met?',
    purpose: 'Exposes text that has no consequence attached, and opens the reporting clause.' },
  { target_country: 'ANY', topic: 'Cost', strength: 'medium',
    question: 'Who is expected to fund the mechanism your delegation has proposed?',
    purpose: 'The question most draft resolutions have not thought about.' },
  { target_country: 'ANY', topic: 'Timeline', strength: 'medium',
    question: 'By when would your delegation expect this to be implemented?',
    purpose: 'Turns an aspiration into an operative deadline.' },
  { target_country: 'ANY', topic: 'Capacity', strength: 'medium',
    question: 'Would your delegation support implementation assistance for states with fewer resources?',
    purpose: 'Coalition-building question. Usually gets a yes, and the yes is quotable later.' },

  // Agenda-specific examples, on the placeholder agenda. Replace these with
  // questions aimed at the delegations actually in your committee.
  { target_country: 'ANY', topic: 'Pledged vs disbursed', strength: 'strong',
    question: 'Can your delegation state what proportion of its pledged adaptation finance has actually been disbursed?',
    purpose: 'Example of a question built on a gap between announcement and delivery.' },
  { target_country: 'ANY', topic: 'Access', strength: 'medium',
    question: 'How long does an application to the fund currently take, from submission to first disbursement?',
    purpose: 'Example of a procedural question that reframes the debate toward access.' },
]

// ────────────────────────────────────────────────────── Q&A / defence bank
//
// `kind` groups these in the UI and must be one of exactly three values:
// 'likely_to_us' for questions you expect to be asked of your delegation,
// 'rapid_response' for one-line comebacks, 'general' for technique.
//
// `short` is the label shown in the list; `question` is the full form.

export const QA = [
  { kind: 'likely_to_us', pinned: 1, short: 'Why is this our priority?',
    question: 'Why has your delegation made this its priority?',
    answer: `Answer in three moves: name the shared problem, explain why your delegation is well placed to speak to it, then give the specific mechanism you want in the text. Avoid answering only the first part — a position without a mechanism cannot be drafted into a resolution, and the delegations writing the text are the ones who set its direction.`, },
  { kind: 'likely_to_us', pinned: 1, short: 'Your own record',
    question: 'Has your own state actually met the commitments it is asking of others?',
    answer: `Do not deny a real weakness — the room will find it, and denial costs you the credibility you need later. Acknowledge the gap plainly, then explain why it is precisely the reason you support the mechanism under discussion. Applying your own proposed standard to yourself, out loud, before anyone forces you to, is the single most effective move available in a committee.`, },
  { kind: 'likely_to_us', short: 'Why this forum?',
    question: 'Why should this body discuss the matter at all?',
    answer: `Be honest about what the forum can and cannot do — see UNGA_POWERS below. The General Assembly can establish principles, request reports and convene work; it cannot bind states or create obligations. Claiming more than that invites a procedural correction you cannot recover from.`, },
  { kind: 'likely_to_us', short: 'Cost',
    question: 'Who pays for what your delegation is proposing?',
    answer: `Have a real answer. "Within existing resources" is the standard formulation where no new funding is being requested, and it is what makes a request to a UN body realistic rather than aspirational.`, },

  { kind: 'rapid_response', pinned: 1, short: 'This is unrealistic',
    question: 'This proposal is unrealistic.',
    answer: `Then help make it realistic — which part of the mechanism would your delegation change?` },
  { kind: 'rapid_response', pinned: 1, short: 'That is not this committee\'s role',
    question: 'That is outside this committee\'s mandate.',
    answer: `Our delegation is not asking this body to exceed its mandate. We are asking it to recommend, and to request a report on delivery.` },
  { kind: 'rapid_response', short: 'You are singling us out',
    question: 'Your delegation is singling us out.',
    answer: `The standard we are proposing applies to every delegation in this room, including our own.` },
  { kind: 'rapid_response', short: 'Words without funding',
    question: 'This is words without funding.',
    answer: `Agreed, which is why our delegation supports a reporting requirement — it is what makes the words checkable.` },

  { kind: 'general', pinned: 1, short: 'Answer pattern',
    question: 'How should I structure any answer to a hostile point of information?',
    answer: `Acknowledge the legitimate part of the question → state your delegation's actual position → return to the specific mechanism you want in the text.

Three rules that matter more than any prepared answer:

Never deny a real weakness. Concede it and explain why it strengthens your argument for the safeguard.
Never answer a question you were not asked. A long answer sounds like evasion.
Always end on the mechanism. The delegation that keeps returning the debate to draftable text is the one whose text gets drafted.` },
]

// ────────────────────────────────────────────────────────────── countries
//
// PLACEHOLDER SCAFFOLDING — not research. This exists to show you which fields
// the country screen renders and how a filled-in entry is shaped. Replace every
// entry with your own work before a committee.
//
// `is_ours: 1` marks your own delegation (exactly one entry should have it).
// `bloc_status` is one of 'strong_ally' | 'ally' | 'neutral' | 'opponent'
// and is preserved across re-seeds once you change it on the bloc board.
// `attacks_defenses` is the attack/answer map — the most valuable field here,
// and the one worth spending your preparation time on.

export const COUNTRIES = [
  {
    code: 'ZZ', name: 'Your Delegation', flag: '🏳️', is_ours: 1, bloc_status: 'strong_ally',
    identity: 'PLACEHOLDER. In one or two sentences: what is the single argument your delegation is in this committee to make? If you cannot state it in one sentence, you are not ready for the general speakers\' list.',
    lead_topic: 'The two or three subtopics you want to own in moderated caucus',
    main_vulnerability: 'The attack you are most likely to face — write it down before someone else finds it',
    position: 'Your tone and role in the room. Are you the drafter, the bridge, the conscience, the technical expert?',
    facts: [
      'PLACEHOLDER. Load this with verifiable facts about your own state\'s position, law and record.',
      'Cite instruments precisely — a delegate who names the article correctly is believed on the next claim too.',
      'Include the facts that are inconvenient for you. You need them ready, not discovered mid-committee.',
      'Anything you have not verified from a primary source belongs in `caution`, not here.',
    ],
    legal_refs: ['Treaties, statutes and resolutions you can cite by name and article'],
    strengths: ['What your delegation can credibly claim', 'Where your record is genuinely strong'],
    vulnerabilities: ['Where your record is weak', 'The gap between your law and your practice'],
    attacks_defenses: [
      { attack: 'The strongest attack you expect to face.', defense: 'Your honest answer. Concede the true part, then return to the mechanism you want in the text.' },
      { attack: 'The second attack.', defense: 'Never invent a defence you do not believe — the room can tell, and you lose the next exchange too.' },
    ],
    questions_to_ask: [
      'The questions you want to put to other delegations',
      'Keep the ones most delegations cannot answer',
    ],
    should_lead_on: ['The clauses you intend to draft', 'The subtopics you should move a caucus on'],
    likely_allies: 'Delegations whose priorities overlap with yours, and what specifically you agree on.',
    likely_opponents: 'Delegations likely to resist, and on which specific point.',
    cooperation: 'How you plan to work with your bloc. Note that a bloc which sounds like one delegation is a bloc the Chair discounts — plan a genuine disagreement.',
    resolution_fit: 'Which operative clauses you should own in the final text.',
    caution: 'Anything you must NOT assert without primary-source verification. Being caught overstating one fact costs you the room for the rest of the session.',
  },
  {
    code: 'YY', name: 'Example Other Delegation', flag: '🏴', is_ours: 0, bloc_status: 'neutral',
    identity: 'PLACEHOLDER. Add one entry per delegation you expect to matter — allies, opponents, and the undecided delegations whose votes decide the resolution.',
    lead_topic: 'What they will push',
    main_vulnerability: 'Where they are exposed',
    position: 'How they are likely to argue',
    facts: ['Verifiable facts about their position and record'],
    legal_refs: ['Instruments they will cite'],
    strengths: ['Their strongest ground'],
    vulnerabilities: ['Their weakest ground'],
    attacks_defenses: [
      { attack: 'What they will say to you.', defense: 'Your prepared answer.' },
    ],
    questions_to_ask: ['The point of information you want to put to them'],
    should_lead_on: ['What you would rather they led on than you'],
    likely_allies: 'Who they will work with.',
    likely_opponents: 'Who they will resist.',
    cooperation: 'Whether there is a trade available, and what it is.',
    resolution_fit: 'What they could realistically co-sponsor.',
    caution: 'Do not speak for another delegation on its own domestic framework. Acknowledge and defer.',
  },
]

// ─────────────────────────────────────────── caucus decision matrix (live)
//
// Read the room, find the row, move the motion. This is the screen you look at
// when the Chair asks for motions and your mind has gone blank.
//
// `room_state` is what you are observing; `motion` is the subtopic to move on;
// `objective` is why; `lead` is which delegation should move it — sometimes the
// answer is deliberately not you.

export const CAUCUS_PLAYS = [
  { room_state: 'Room is philosophical / abstract', motion: 'A specific mechanism, named', objective: 'Move the debate from principle to draftable text.', lead: 'You' },
  { room_state: 'Room is arguing a false binary', motion: 'The conditions under which both hold', objective: 'Reject the framing rather than pick a side of it.', lead: 'You' },
  { room_state: 'Room is repeating itself', motion: 'Skip the next moderated caucus, or move to drafting', objective: 'Show judgment. Chairs notice the delegate who moves the committee forward.', lead: 'You' },
  { room_state: 'Room is ignoring implementation', motion: 'Capacity-building and technical assistance', objective: 'Bring in the delegations whose votes you need.', lead: 'An ally from the affected bloc' },
  { room_state: 'Room is attacking your delegation\'s record', motion: 'The standard applied universally', objective: 'Reframe from your record to a common rule. Do this before you are cornered.', lead: 'You' },
  { room_state: 'Room has split into two blocs', motion: 'The narrowest point both blocs already agree on', objective: 'Find the text everyone can sign, then build outward from it.', lead: 'A neutral delegation' },
  { room_state: 'No draft exists and time is short', motion: 'An unmoderated caucus for drafting', objective: 'A resolution that does not exist cannot pass. Stop debating and write.', lead: 'You' },
  { room_state: 'Your motion just failed', motion: 'The same subtopic, different duration or speaking time', objective: 'Listen to what the room preferred, adjust, and let someone else move it.', lead: 'An ally' },
]

// ────────────────────────────────────── clause library (draftable language)
//
// `kind` is 'OP' (operative, numbered) or 'PRE' (preambulatory). `opener` must
// be a verb the General Assembly can actually use — see UNGA_POWERS.verbs_ok.
// `priority` 1–3 orders the list. Operative clauses end in a semicolon; the
// final clause of a resolution ends in a full stop.

export const CLAUSE_LIBRARY = [
  // Preambulatory — context, principles and concerns. Participial openings.
  { kind: 'PRE', opener: 'Recalling', priority: 1, topic: 'Prior commitments', text: 'the commitments previously undertaken by Member States in respect of the matter under consideration, and the importance of their full and timely implementation,' },
  { kind: 'PRE', opener: 'Reaffirming', priority: 1, topic: 'Shared responsibility', text: 'that the objective under consideration is a shared responsibility of Member States, to be pursued in accordance with their respective capabilities and circumstances,' },
  { kind: 'PRE', opener: 'Recognising', priority: 1, topic: 'Differing capacity', text: 'that Member States face differing resource and institutional constraints in giving effect to common commitments,' },
  { kind: 'PRE', opener: 'Concerned', priority: 1, topic: 'Delivery gap', text: 'that a persistent gap between commitments announced and commitments delivered undermines confidence in multilateral cooperation,' },
  { kind: 'PRE', opener: 'Noting', priority: 2, topic: 'Existing bodies', text: 'the work already undertaken by the relevant organs, funds and programmes of the United Nations system,' },

  // Operative — the actual actions. Numbered in the final document.
  { opener: 'Calls upon', priority: 1, topic: 'Predictability', text: 'Member States to place commitments on a multi-year basis, with a published indicative floor, so that recipient States are able to plan across budget cycles;' },
  { opener: 'Urges', priority: 1, topic: 'Access', text: 'the relevant funds and programmes to simplify access procedures and to expand direct accreditation for the Member States with the most limited administrative capacity;' },
  { opener: 'Encourages', priority: 1, topic: 'Transparency', text: 'Member States to report annually, on a common format, both commitments made and amounts actually disbursed;' },
  { opener: 'Requests', priority: 1, topic: 'Reporting', text: 'the Secretary-General to report to the General Assembly at its next session on progress in the implementation of the present resolution, within existing resources;' },
  { opener: 'Invites', priority: 2, topic: 'Technical assistance', text: 'the relevant United Nations bodies, within existing resources, to provide technical assistance and capacity-building, including model frameworks and training, upon the request of Member States;' },
  { opener: 'Recognises', priority: 2, topic: 'Differentiated timelines', text: 'that differentiated implementation timelines are compatible with a common underlying standard;' },
  { opener: 'Decides', priority: 3, topic: 'Seizure', text: 'to remain seized of the matter.' },
]

// What the General Assembly can and cannot do. General and factual — this is
// worth keeping whatever your committee and agenda. A resolution that asks the
// Assembly to do something it has no power to do will be corrected on the floor,
// and the correction is expensive.
//
// If your committee is NOT the General Assembly (a Security Council, ECOSOC or
// a specialised body), replace this with your own organ's powers — the verbs and
// the limits are different.

export const UNGA_POWERS = {
  can: ['recommend', 'call upon', 'urge', 'invite', 'encourage', 'affirm', 'request reports from the Secretary-General', 'request work from existing bodies (OHCHR, ITU, UNODC)', 'establish working groups', 'convene expert meetings', 'request studies', 'decide to remain seized of the matter', 'place items on future agendas'],
  cannot: ['bind Member States', 'create legal obligations', 'establish inspection or verification regimes over sovereign States', 'mandate sanctions', 'require States to submit national programmes for external review', 'create courts'],
  verbs_ok: ['Calls upon', 'Urges', 'Encourages', 'Invites', 'Requests', 'Recommends', 'Affirms', 'Recognises'],
  verbs_avoid: ['Requires', 'Mandates', 'Obliges', 'Shall', 'Compels', 'Directs'],
}

// ───────────────────────────────────────────────────────── procedure cards
//
// General Model UN practice, applicable to any committee. Every card is seeded
// as GENERAL_PRACTICE; promote one to RPS_CONFIRMED in the app once your Chair
// announces the local rule, and re-seeding will never overwrite it.
//
// Conference rules vary on almost everything below — speaking times, motion
// wording, voting thresholds, whether points of information are permitted, and
// sponsor requirements. Where the Chair announces a different rule, follow the
// Chair.

export const PROCEDURE = [
  { topic: 'Flow', title: 'The entire MUN flow', ordinal: 0,
    body: `Roll Call → Opening / Agenda → General Speakers' List → Moderated Caucuses → Unmoderated Caucuses → Working Paper → Draft Resolution → Amendments → Final Debate → Voting Procedure → Results / Adjournment.

Speaking times, motion wording, voting thresholds, POIs and sponsor requirements differ between conferences. If the Chair gives a different rule, follow the Chair.` },
  { topic: 'Roll call', title: 'Roll call — "Present" vs "Present and Voting"', ordinal: 1,
    body: `"Present" — you are present; in many formats you retain the ability to abstain on substantive votes.
"Present and voting" — in many formats you commit to voting for or against on substantive matters rather than abstaining.

Choose deliberately. This app will not choose for you.`,
    wording: 'Present.' },
  { topic: 'GSL', title: 'Opening the General Speakers\' List', ordinal: 2,
    body: `The GSL is the running list of delegations wishing to give general speeches, and is normally the default formal debate when no caucus is active.

Purpose: state your overall position, introduce your framework, signal what you want discussed, and identify potential allies. Aim for slots 3–6.`,
    wording: 'Motion to open the General Speakers\' List.' },
  { topic: 'Speaking time', title: 'Setting speaking time', ordinal: 3,
    body: 'Raise only when the Chair asks for motions or speaking time is being set.',
    wording: 'Motion to set individual speaking time at 90 seconds.' },
  { topic: 'Moderated caucus', title: 'Moderated caucus', ordinal: 4,
    body: `Structured debate on a specific subtopic. The Chair sets total duration and per-speaker time and calls delegates by placard. POIs are usually not used during the speech — check your rules.

Formula: total time + speaking time + a SPECIFIC subtopic. A vague topic loses the vote.`,
    wording: 'Motion for a moderated caucus of [X] minutes, with [Y] seconds per speaker, on [specific subtopic].' },
  { topic: 'Unmoderated caucus', title: 'Unmoderated caucus', ordinal: 5,
    body: `Free discussion and movement for a set period. This is where blocs form, negotiation happens and resolutions are written.

Use the FIRST unmod to map the room. Use the SECOND to begin actual drafting. Before time ends, decide the next drafting step.`,
    wording: 'Motion for a 15-minute unmoderated caucus for bloc consultation and drafting.' },
  { topic: 'Working paper', title: 'Working paper', ordinal: 6,
    body: 'An early, informal collection of ideas. Not yet a formal resolution and normally needs Chair approval before circulation. Get the core ideas down first; do not spend a whole unmod formatting.' },
  { topic: 'Draft resolution', title: 'Draft resolution structure', ordinal: 7,
    body: `Preambulatory clauses explain context, recall principles/treaties/resolutions and identify concerns. They normally use participial openings — "Recognising," "Recalling," "Concerned," "Emphasising."

Operative clauses state the actual actions and are numbered. Use realistic UNGA language: "Encourages," "Calls upon," "Urges," "Invites," "Requests."

Write for the whole committee, not only your own country.` },
  { topic: 'Sponsors', title: 'Sponsors & signatories', ordinal: 8,
    body: 'Sponsors wrote/support the draft. Signatories generally want the draft debated but do not necessarily support every part. Minimum numbers vary by conference. Do not assume a signature equals a yes vote — ask the Chair what the local rules require.' },
  { topic: 'Amendments', title: 'Amendments', ordinal: 9,
    body: `Friendly amendments are changes accepted by all sponsors and are often adopted without a vote; unfriendly amendments are debated and voted on. Some conferences do not use this distinction — check.

When one is proposed: read the exact wording → ask whether it crosses a red line or merely improves clarity → negotiate before the formal vote.

Do not refuse amendments out of pride.`,
    wording: 'We can accept the amendment if the delegation changes [wording], because our concern is [specific issue].' },
  { topic: 'Voting', title: 'Closing debate & entering voting', ordinal: 10,
    body: `Finish substantive debate and drafting, ensure the draft has been submitted and approved, and complete amendment procedures first.

Voting procedure is closed — delegates generally cannot enter or leave.`,
    wording: 'Motion to close debate and enter voting procedure.' },
  { topic: 'Voting', title: 'Procedural vs substantive votes', ordinal: 11,
    body: `Procedural votes decide motions such as entering a caucus. Usually simple majority, and abstentions are normally not allowed.

Substantive votes decide draft resolutions and unfriendly amendments. These generally allow yes, no or abstain.

Conference rules override this. Watch which document is being voted on.` },
  { topic: 'Points', title: 'Points — do not confuse them', ordinal: 12,
    body: `Point of Information (POI) — a question to a speaker, when permitted.
Point of Order — you believe a procedural rule has been violated.
Point of Personal Privilege — you cannot hear, or another permitted personal need.
Point of Parliamentary Inquiry — a question to the Chair about procedure.` },
  { topic: 'Motions', title: 'If your motion fails', ordinal: 13,
    body: `Do not argue with the Chair. Do not immediately repeat the same motion. Listen to what the room preferred, wait for another opportunity, and adjust the topic, duration or speaking time. Sometimes let another delegation move it.` },
  { topic: 'Multiple drafts', title: 'Multiple draft resolutions', ordinal: 14,
    body: 'Multiple resolutions may pass in a General Assembly. The order and method for considering competing drafts is conference-specific — follow the Chair\'s announced procedure.' },
  { topic: 'After the vote', title: 'After the vote', ordinal: 15,
    body: 'The Chair announces the result. Do not assume the committee immediately ends — there may be another draft, another agenda item, a suspension or an adjournment. Wait for the Chair to officially end the session.' },
  { topic: 'Mistakes', title: 'Beginner mistakes to avoid', ordinal: 16,
    body: `Raising motions when the Chair has not asked for them. Making a vague caucus topic instead of a specific subtopic. Using an unmod only to chat with friends. Writing a resolution only your own country could accept. Confusing sponsors and signatories. Assuming friendly/unfriendly amendments exist without checking. Trying to win every procedural vote. Rejecting every amendment because it was not your idea. Leaving during closed voting. Reading every speech word-for-word. Arguing with the Chair about a procedural decision. Making an allied bloc sound like one country.` },
]

// ────────────────────────────────────────────────────────────── priorities
//
// Your session goals, shown as a checklist on the dashboard. Keep it short
// enough that you can actually read it between motions.

export const PRIORITIES = [
  'Get onto the General Speakers\' List around slots 3–6',
  'Move a moderated caucus on the subtopic you want to own',
  'Put your delegation\'s name on a draft resolution as a sponsor',
  'Identify the two delegations whose votes you need and find their red lines',
  'Ask one prepared point of information you know most delegations cannot answer',
  'Concede something early to a bloc you need, and convert it into operative text',
]

// The first ten minutes, which is where most delegates lose the room. Each entry
// pairs a moment with what to do and the exact words to say.

export const OPENING_MOMENTS = [
  { moment: 'Roll call', action: 'If unsure, "present" preserves the ability to abstain.', wording: 'Present.' },
  { moment: 'Open GSL', action: 'Move or second cleanly and briefly.', wording: 'Motion to open the General Speakers\' List.' },
  { moment: 'Speaking time', action: 'Support a workable period if asked.', wording: 'Motion to set individual speaking time at 90 seconds.' },
  { moment: 'First GSL speech', action: 'Use the prepared opening. Plant the one idea you want the room to repeat back to you.', wording: 'Use your 30-second opening, and end on a concrete ask.' },
  { moment: 'First moderated caucus', action: 'Move on the subtopic you are strongest on, before someone else sets the frame.', wording: 'Motion for a 10-minute moderated caucus, 45 seconds per speaker, on [your specific subtopic].' },
  { moment: 'Unmoderated caucus', action: 'Map red lines first, then start drafting. Do not spend it socialising.', wording: 'Motion for a 15-minute unmoderated caucus for drafting and bloc consultation.' },
  { moment: 'Voting', action: 'Only when the paper is ready and the rules permit.', wording: 'Motion to close debate and enter voting procedure.' },
]

// Lines that move a negotiation forward. Generic by design — these work in any
// committee, and they are most useful in the unmoderated caucus where you have
// to talk to strangers with an agenda.

export const NEGOTIATION_LINES = [
  'What is the one clause your delegation needs in the final text?',
  'We can compromise on the institutional form; we should not compromise on what the mechanism actually does.',
  'Let us trade a preambular point for stronger operative language.',
  'Our delegation can accept phased implementation if the underlying standard stays common.',
  'We are willing to apply this rule to ourselves.',
  'Can we combine these two clauses and make the mechanism clearer?',
  'Would your delegation support this if we added implementation assistance?',
  'Let us identify the exact wording both sides can sign.',
  'Who else in this room already agrees with you on that point?',
]
