const ALLOWED_ORIGINS = new Set([
  'https://counterpart-ai-team-julie88liu-7550.vercel.app',
  'https://counterpart-ai-team.vercel.app',
]);

const MODELS = {
  qwen: '@cf/qwen/qwen3-30b-a3b-fp8',
  llama: '@cf/meta/llama-3.1-8b-instruct-fast',
  mistral: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  gemma: '@cf/google/gemma-4-26b-a4b-it',
};

const AGENTS = {
  inventor: {
    name: 'Inventor',
    model: MODELS.qwen,
    label: 'Qwen3 30B',
    role:
      'Generate genuinely different approaches. Challenge the obvious solution. Favor novel but buildable ideas.',
  },

  engineer: {
    name: 'Engineer',
    model: MODELS.mistral,
    label: 'Mistral Small 3.1',
    role:
      'Judge technical feasibility, dependencies, reliability, scaling, failure modes, and implementation constraints.',
  },

  researcher: {
    name: 'Researcher',
    model: MODELS.llama,
    label: 'Llama 3.1 8B Fast',
    role:
      'Separate knowns from unknowns, identify evidence gaps, prior-art questions, and what should be researched next. Do not claim live web research.',
  },

  redteam: {
    name: 'Red Team',
    model: MODELS.gemma,
    label: 'Gemma 4 26B',
    role:
      'Try to break the plan. Hunt for hidden assumptions, contradictions, edge cases, misuse, and real-world failure modes.',
  },

  business: {
    name: 'Business Strategist',
    model: MODELS.qwen,
    label: 'Qwen3 30B',
    role:
      'Evaluate customer value, positioning, economics, competition, monetization, operational burden, and whether the project is worth doing.',
  },

  product: {
    name: 'Product Designer',
    model: MODELS.gemma,
    label: 'Gemma 4 26B',
    role:
      'Optimize workflow, usability, defaults, ergonomics, discoverability, simplicity, and what should be removed.',
  },

  architect: {
    name: 'Software Architect',
    model: MODELS.mistral,
    label: 'Mistral Small 3.1',
    role:
      'Design clean architecture, interfaces, data flow, APIs, state, persistence, provider boundaries, observability, and maintainability.',
  },

  coder: {
    name: 'Builder / Coder',
    model: MODELS.qwen,
    label: 'Qwen3 30B',
    role:
      'Turn ideas into concrete implementation steps. Identify code-level pitfalls and propose the smallest robust build path.',
  },

  qa: {
    name: 'QA & Test',
    model: MODELS.llama,
    label: 'Llama 3.1 8B Fast',
    role:
      'Design acceptance criteria, regression checks, edge cases, falsification tests, and ways to catch failures before users do.',
  },

  safety: {
    name: 'Safety & Compliance',
    model: MODELS.mistral,
    label: 'Mistral Small 3.1',
    role:
      'Identify safety, privacy, legal, regulatory, accessibility, compliance, and liability concerns. Distinguish review flags from hard blockers.',
  },

  manufacturing: {
    name: 'Manufacturing',
    model: MODELS.gemma,
    label: 'Gemma 4 26B',
    role:
      'For physical products, analyze materials, assembly, sourcing, tooling, QC, serviceability, and production risk. For software, analyze deployment and operational production concerns.',
  },

  cost: {
    name: 'Cost & Simplicity',
    model: MODELS.llama,
    label: 'Llama 3.1 8B Fast',
    role:
      'Reduce parts, steps, dependencies, recurring costs, maintenance, and owner effort while preserving the outcome that matters.',
  },

  customer: {
    name: 'Customer Simulator',
    model: MODELS.qwen,
    label: 'Qwen3 30B',
    role:
      'Simulate skeptical, enthusiastic, confused, price-sensitive, novice, and power users. Predict objections, misunderstandings, adoption and abandonment.',
  },

  security: {
    name: 'Security',
    model: MODELS.mistral,
    label: 'Mistral Small 3.1',
    role:
      'Threat-model authentication, data exposure, injection, abuse, secrets, permissions, dependencies, and denial-of-service risks.',
  },

  pm: {
    name: 'Project Manager',
    model: MODELS.llama,
    label: 'Llama 3.1 8B Fast',
    role:
      'Turn the project into decisions, dependencies, milestones, sequencing, risks, and the next smallest concrete step. Prevent scope drift.',
  },
};

const FIXED_CORE = [
  'inventor',
  'engineer',
  'redteam',
  'business',
  'product',
  'qa',
];

const GENERAL_FILL = [
  'engineer',
  'redteam',
  'qa',
  'product',
  'inventor',
  'pm',
  'researcher',
  'cost',
];

const ROUTES = [
  {
    name: 'software / AI',
    test:
      /\b(app|software|code|coding|api|database|server|backend|frontend|website|web app|automation|workflow|ai|agent|agents|model|cloud|worker|vercel|cloudflare|github|integration)\b/i,
    scores: {
      architect: 6,
      coder: 5,
      security: 4,
      qa: 4,
      engineer: 3,
      pm: 3,
      redteam: 3,
      product: 2,
    },
  },

  {
    name: 'physical product / invention',
    test:
      /\b(invent|invention|device|hardware|product design|prototype|material|manufactur|factory|tooling|mechanism|battery|heat|temperature|food-safe|component|assembly)\b/i,
    scores: {
      inventor: 6,
      engineer: 6,
      manufacturing: 5,
      cost: 4,
      safety: 4,
      product: 3,
      redteam: 3,
      qa: 2,
    },
  },

  {
    name: 'business / market',
    test:
      /\b(business|market|customer|price|pricing|revenue|profit|competition|competitor|launch|sell|sales|subscription|membership|unit economics|positioning|brand)\b/i,
    scores: {
      business: 6,
      customer: 5,
      product: 4,
      cost: 4,
      researcher: 3,
      redteam: 3,
      pm: 2,
    },
  },

  {
    name: 'research / evidence',
    test:
      /\b(research|evidence|study|studies|paper|papers|patent|prior art|compare|comparison|validate|verify|fact|facts|review literature|data)\b/i,
    scores: {
      researcher: 6,
      redteam: 4,
      qa: 3,
      engineer: 2,
      business: 2,
      safety: 2,
    },
  },

  {
    name: 'user experience',
    test:
      /\b(user experience|ux|ui|interface|customer experience|ergonomic|easy to use|onboarding|usability|design language)\b/i,
    scores: {
      product: 6,
      customer: 5,
      qa: 3,
      business: 2,
      inventor: 2,
      redteam: 2,
    },
  },

  {
    name: 'safety / security / compliance',
    test:
      /\b(safety|safe|security|secure|privacy|legal|compliance|regulation|regulatory|liability|hazard|risk|auth|authentication|permission|secret)\b/i,
    scores: {
      safety: 6,
      security: 6,
      redteam: 5,
      qa: 3,
      engineer: 2,
      pm: 2,
    },
  },

  {
    name: 'planning / operations',
    test:
      /\b(plan|planning|roadmap|timeline|milestone|operations|operate|process|organize|project management|schedule|workflow)\b/i,
    scores: {
      pm: 6,
      cost: 3,
      redteam: 3,
      qa: 2,
      researcher: 2,
      engineer: 2,
    },
  },

  {
    name: 'creative ideation',
    test:
      /\b(brainstorm|idea|ideas|creative|novel|different approach|concept|name|naming|design concept)\b/i,
    scores: {
      inventor: 6,
      product: 4,
      customer: 3,
      redteam: 2,
      business: 2,
      engineer: 2,
    },
  },
];

function smartRoute(project, goal) {
  const text = `${project}\n${goal}`;
  const scores = {};
  const matched = [];

  for (const route of ROUTES) {
    if (!route.test.test(text)) continue;

    matched.push(route.name);

    for (const [id, points] of Object.entries(route.scores)) {
      scores[id] = (scores[id] || 0) + points;
    }
  }

  if (!matched.length) {
    for (const [i, id] of GENERAL_FILL.entries()) {
      scores[id] = 10 - i;
    }

    matched.push('general problem solving');
  }

  scores.redteam = (scores.redteam || 0) + 1;

  const ranked = Object.entries(scores)
    .filter(([id]) => AGENTS[id])
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(b[0])
    )
    .map(([id]) => id);

  for (const id of GENERAL_FILL) {
    if (!ranked.includes(id)) {
      ranked.push(id);
    }
  }

  return {
    ids: ranked.slice(0, 6),
    matched,
  };
}

function cors(origin) {
  const allowed =
    ALLOWED_ORIGINS.has(origin)
      ? origin
      : '';

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,X-Counterpart-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors(origin),
      },
    }
  );
}

function clean(value, max = 12000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function resultText(result) {
  if (!result) return '';

  if (typeof result === 'string') {
    return result;
  }

  const chatContent =
    result?.choices?.[0]?.message?.content;

  if (typeof chatContent === 'string') {
    return chatContent;
  }

  if (typeof result.response === 'string') {
    return result.response;
  }

  if (
    typeof result.result?.response ===
    'string'
  ) {
    return result.result.response;
  }

  if (typeof result.text === 'string') {
    return result.text;
  }

  return '';
}

function stripThinking(text) {
  return String(text || '')
    .replace(
      /<think>[\s\S]*?<\/think>/gi,
      ''
    )
    .replace(
      /<analysis>[\s\S]*?<\/analysis>/gi,
      ''
    )
    .trim();
}

function cleanLeadOutput(text) {
  let t = stripThinking(text);

  const finalMatch =
    t.match(
      /<FINAL>\s*([\s\S]*?)\s*<\/FINAL>/i
    );

  if (finalMatch) {
    t = finalMatch[1].trim();
  }

  const idx =
    t
      .toUpperCase()
      .indexOf(
        'FINAL RECOMMENDATION'
      );

  if (idx >= 0) {
    t = t.slice(idx);
  }

  return t
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeLoop(text) {
  const t =
    String(text || '').trim();

  if (t.length < 180) {
    return true;
  }

  const lower = t.toLowerCase();

  const obvious = [
    'do not use markdown',
    'do not use bullet points',
    'do not use the word',
  ];

  for (const phrase of obvious) {
    if (
      lower.split(phrase).length - 1 >= 3
    ) {
      return true;
    }
  }

  const lines =
    t
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);

  if (lines.length >= 6) {
    const unique =
      new Set(
        lines.map(
          x => x.toLowerCase()
        )
      );

    if (
      unique.size /
        lines.length <
      0.45
    ) {
      return true;
    }
  }

  return false;
}

function hasLeadStructure(text) {
  const t =
    String(text || '')
      .toUpperCase();

  return (
    t.includes(
      'FINAL RECOMMENDATION'
    ) &&
    t.includes(
      'EVIDENCE STATUS'
    ) &&
    t.includes(
      'NEXT CONCRETE STEP'
    )
  );
}

async function runModel(
  env,
  model,
  system,
  user,
  maxTokens = 520,
  temperature = 0.4
) {
  const input = {
    messages: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: user,
      },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  if (model === MODELS.qwen) {
    input.repetition_penalty = 1.12;
    input.frequency_penalty = 0.2;
  }

  const result =
    await env.AI.run(
      model,
      input
    );

  return stripThinking(
    resultText(result)
  );
}

function agentBrief(
  agent,
  project,
  goal,
  context
) {
  return `
You are the ${agent.name} on a multi-agent project council.

SPECIALTY
${agent.role}

EVIDENCE RULES
A fact must come directly from PROJECT, GOAL, or LOCKED PROJECT MEMORY / CONTEXT below.
LOCKED PROJECT MEMORY / CONTEXT is authoritative user-provided fact for this run.
Do not downgrade locked memory to an assumption, inference, likelihood, or item to re-verify unless the GOAL explicitly asks you to audit the truth of that memory.
Do not recommend implementing, adding, creating, confirming, or verifying a capability that locked memory explicitly says already exists.
You may recommend improving, testing, hardening, measuring, or replacing an existing capability, but state clearly that it already exists first.
Anything not supplied by PROJECT, GOAL, or locked memory must be clearly identified as an inference, idea, or unknown.
Never claim that you possess data, proof, test results, research, or web findings unless they are explicitly supplied in the brief.
If outside evidence is needed, state exactly what the Premium Lead should verify.

COLLABORATION RULES
Think independently.
Do not assume consensus.
Be concrete and willing to disagree.
Identify one claim that deserves challenge.

PROJECT
${project}

GOAL / PROBLEM
${goal}

${context
  ? `LOCKED PROJECT MEMORY / CONTEXT
${context}`
  : ''}

Return these sections:
FACTS FROM PROVIDED BRIEF
INFERENCES
IDEAS / RECOMMENDATIONS
RISKS / OBJECTIONS
UNKNOWNS TO VERIFY
POINT TO CHALLENGE
NEXT ACTION
`;
}

async function runAgent(
  env,
  id,
  project,
  goal,
  context
) {
  const agent = AGENTS[id];

  if (!agent) {
    throw new Error(
      `Unknown agent: ${id}`
    );
  }

  const content =
    await runModel(
      env,
      agent.model,
      `You are Counterpart's ${agent.name}. ${agent.role}`,
      agentBrief(
        agent,
        project,
        goal,
        context
      ),
      500,
      id === 'inventor' ||
      id === 'customer'
        ? 0.65
        : 0.35
    );

  return {
    id,
    name: agent.name,
    model: agent.label,
    content,
  };
}

function councilText(reports) {
  return reports
    .map(
      r =>
        `### ${r.name} (${r.model})
${r.content ||
`ERROR: ${r.error}`}`
    )
    .join('\n\n');
}

async function targetedReview(
  env,
  project,
  goal,
  context,
  reports
) {
  return runModel(
    env,
    MODELS.mistral,
    `You are Counterpart Targeted Review.
Identify only material conflicts,
unsupported claims,
and important minority objections.
Treat LOCKED CONTEXT as authoritative user-provided fact for this run.
Flag any specialist that questions a locked fact without being asked to audit it.
Flag any recommendation to build, add, verify, or confirm a capability the locked context says already exists.
Never invent evidence.`,
    `
PROJECT:
${project}

GOAL:
${goal}

${context
  ? `LOCKED CONTEXT:
${context}`
  : ''}

SPECIALIST REPORTS:
${councilText(reports)}

Before writing, compare every specialist claim and recommendation against LOCKED CONTEXT. Preserve improvements to existing capabilities, but reject recommendations that merely recreate or re-verify capabilities already stated as present.

Return four short sections:

MATERIAL DISAGREEMENTS

UNSUPPORTED CLAIMS

MINORITY VIEW WORTH PRESERVING

WHAT LEAD MUST RESOLVE

Maximum three resolution items.
`,
    520,
    0.2
  );
}

function memoryCapabilityTerms(context) {
  const c = String(context || '').toLowerCase();
  const terms = new Set();

  const vocabulary = [
    'architecture',
    'routing',
    'router',
    'review',
    'cross-review',
    'synthesis',
    'lead',
    'memory',
    'fallback',
    'guard',
    'security',
    'authentication',
    'authorization',
    'database',
    'backend',
    'frontend',
    'worker',
    'model',
    'models',
    'agent',
    'agents',
    'specialist',
    'specialists',
    'api',
    'integration',
    'deployment',
    'testing',
    'evidence',
    'verification',
    'orchestration',
    'coordination',
    'storage',
    'persistence',
    'encryption',
    'billing',
    'cost control',
    'rate limiting',
  ];

  for (const term of vocabulary) {
    if (c.includes(term)) terms.add(term);
  }

  if (
    c.includes('smart team') &&
    c.includes('routing')
  ) {
    terms.add('dynamic routing');
    terms.add('task routing');
    terms.add('router');
  }

  if (
    c.includes('lead') &&
    (
      c.includes('synthesizes') ||
      c.includes('synthesis') ||
      c.includes('resolves conflicts')
    )
  ) {
    terms.add('coordination');
    terms.add('orchestration');
    terms.add('coordination layer');
  }

  if (
    c.includes('evidence-discipline') ||
    c.includes('evidence discipline')
  ) {
    terms.add('evidence verification');
    terms.add('verification layer');
  }

  return [...terms];
}

function findMemoryContradictions(context, text) {
  if (!context || !text) return [];

  const terms = memoryCapabilityTerms(context);
  if (!terms.length) return [];

  const actionPattern =
    /\b(implement|build|create|develop|add|introduce|establish|set up|setup|deploy|enable|adopt|verify|confirm)\b/i;

  const chunks =
    String(text)
      .split(/\n+|(?<=[.!?])\s+/)
      .map(x => x.trim())
      .filter(Boolean);

  const issues = [];

  for (const chunk of chunks) {
    if (!actionPattern.test(chunk)) continue;

    const lower = chunk.toLowerCase();
    const matched = terms.filter(
      term => lower.includes(term)
    );

    if (matched.length) {
      issues.push({
        text: chunk.slice(0, 320),
        terms: matched.slice(0, 4),
      });
    }
  }

  return issues.slice(0, 6);
}

function leadPrompt(
  project,
  goal,
  context,
  reports,
  review
) {
  return `
PROJECT
${project}

GOAL
${goal}

${context
  ? `LOCKED PROJECT MEMORY / CONTEXT
${context}`
  : ''}

INDEPENDENT SPECIALIST REPORTS
${councilText(reports)}

${review
  ? `TARGETED CROSS-REVIEW
${review}`
  : ''}

Create the senior decision memo now.

Before writing, silently inventory every capability and architectural fact explicitly stated in LOCKED PROJECT MEMORY / CONTEXT. That inventory is authoritative for this run.
Do not recommend implementing, adding, creating, verifying, or confirming anything on that inventory as though it were missing.
If an existing capability is weak, recommend improving, testing, measuring, hardening, or replacing it, and explicitly acknowledge that it already exists.
Do not describe a locked fact as likely, assumed, inferred, unverified, or something that must first be confirmed unless the GOAL explicitly asks you to audit the truth of locked memory.

Use these headings exactly once:

FINAL RECOMMENDATION

WHY THIS WINS

EVIDENCE STATUS

WHAT THE COUNCIL DISAGREED ABOUT

RISKS / UNKNOWNS

THREE MOST IMPORTANT IMPROVEMENTS OR DECISIONS

NEXT CONCRETE STEP

Rules:
Judge rather than average.
Specialist opinions are not evidence.
LOCKED PROJECT MEMORY / CONTEXT is user-provided fact, not inference.
Under EVIDENCE STATUS, separate locked/user-provided facts from inference or proposals.
Do not invent research, data, tests, or proof.
Do not propose recreating a capability already stated as present in locked memory.
Keep the memo concise and actionable.
`;
}

async function synthesize(
  env,
  project,
  goal,
  context,
  reports,
  review
) {
  const prompt =
    leadPrompt(
      project,
      goal,
      context,
      reports,
      review
    );

  let text =
    await runModel(
      env,
      MODELS.gemma,
      `You are Counterpart Lead.
Produce only a polished senior decision memo.
Treat locked project memory as authoritative user-provided fact.
No scratchpad or self-talk.`,
      prompt,
      780,
      0.2
    );

  text =
    cleanLeadOutput(text);

  let fallbackUsed = false;
  let model = 'Gemma 4 26B';
  let memoryRewriteUsed = false;

  if (
    looksLikeLoop(text) ||
    !hasLeadStructure(text)
  ) {
    fallbackUsed = true;
    model = 'Mistral Small 3.1';

    text =
      await runModel(
        env,
        MODELS.mistral,
        `You are the fallback Counterpart Lead.
Treat locked project memory as authoritative user-provided fact.
Return a clean final decision memo only.`,
        prompt,
        760,
        0.15
      );

    text =
      cleanLeadOutput(text);
  }

  const memoryIssues =
    findMemoryContradictions(
      context,
      text
    );

  if (memoryIssues.length) {
    memoryRewriteUsed = true;
    fallbackUsed = true;
    model = 'Mistral Small 3.1';

    const issueText =
      memoryIssues
        .map(
          (item, i) =>
            `${i + 1}. ${item.text}\nMatched existing-memory concept(s): ${item.terms.join(', ')}`
        )
        .join('\n\n');

    text =
      await runModel(
        env,
        MODELS.mistral,
        `You are Counterpart's grounding repair Lead.
Rewrite the decision memo so locked project memory is treated as authoritative fact.
Do not recommend building, adding, verifying, or confirming capabilities that locked memory already says exist.
You may recommend improving or testing those capabilities, but explicitly acknowledge they already exist.
Return only the corrected decision memo.`,
        `${prompt}\n\nGROUNDING REPAIR NOTICE\nThe previous synthesis likely duplicated or downgraded locked-memory capabilities. Correct these suspected issues:\n\n${issueText}`,
        780,
        0.1
      );

    text =
      cleanLeadOutput(text);
  }

  if (looksLikeLoop(text)) {
    throw new Error(
      'Lead model entered a repetition loop. Counterpart blocked the bad output instead of showing it. Please retry once.'
    );
  }

  if (!hasLeadStructure(text)) {
    throw new Error(
      'Lead model did not return the required decision-memo structure. Counterpart blocked the malformed output instead of showing it. Please retry once.'
    );
  }

  return {
    text,
    model,
    fallbackUsed,
    memoryRewriteUsed,
  };
}

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    const origin =
      request.headers.get(
        'Origin'
      ) || '';

    if (
      request.method ===
      'OPTIONS'
    ) {
      if (
        origin &&
        !ALLOWED_ORIGINS.has(
          origin
        )
      ) {
        return json(
          {
            error:
              'Origin not allowed',
          },
          403,
          origin
        );
      }

      return new Response(
        null,
        {
          status: 204,
          headers: cors(origin),
        }
      );
    }

    if (
      request.method ===
        'GET' &&
      (
        url.pathname === '/' ||
        url.pathname === '/health'
      )
    ) {
      return json(
        {
          ok: true,
          service:
            'Counterpart AI Backend',
          version: '1.1.2',
          backend:
            'Cloudflare Workers AI',
          binding:
            Boolean(env.AI),

          models: [
            ...new Set(
              Object.values(MODELS)
            ),
          ],

          lead:
            'Gemma 4 26B with Mistral fallback',

          features: [
            'smart-routing',
            'evidence-discipline',
            'messages-api',
            'clean-final-synthesis',
            'anti-repetition-guard',
            'lead-fallback',
            'targeted-cross-review',
            'gemma-response-parser-fix',
            'authoritative-memory-grounding',
            'memory-contradiction-rewrite',
          ],
        },
        200,
        origin
      );
    }

    if (
      request.method !==
        'POST' ||
      url.pathname !==
        '/api/team'
    ) {
      return json(
        {
          error: 'Not found',
        },
        404,
        origin
      );
    }

    if (
      origin &&
      !ALLOWED_ORIGINS.has(
        origin
      )
    ) {
      return json(
        {
          error:
            'Origin not allowed',
        },
        403,
        origin
      );
    }

    if (!env.AI) {
      return json(
        {
          error:
            'Workers AI binding "AI" is missing.',
        },
        500,
        origin
      );
    }

    try {
      const body =
        await request.json();

      const project =
        clean(
          body.project ||
            'General',
          200
        );

      const goal =
        clean(
          body.goal,
          8000
        );

      const context =
        clean(
          body.context,
          12000
        );

      const deep =
        Boolean(body.deep);

      const smart =
        body.smart !== false;

      if (!goal) {
        return json(
          {
            error:
              'Goal/problem is required.',
          },
          400,
          origin
        );
      }

      let ids;
      let routeMeta;

      if (smart) {
        const route =
          smartRoute(
            project,
            goal
          );

        ids = route.ids;

        routeMeta = {
          mode: 'smart',
          matchedCategories:
            route.matched,
        };
      } else {
        const requested =
          Array.isArray(
            body.agentIds
          )
            ? body.agentIds
            : FIXED_CORE;

        ids = [
          ...new Set(
            requested.filter(
              id => AGENTS[id]
            )
          ),
        ].slice(0, 15);

        routeMeta = {
          mode: 'manual',
          matchedCategories: [],
        };
      }

      if (!ids.length) {
        return json(
          {
            error:
              'Select at least one valid specialist.',
          },
          400,
          origin
        );
      }

      const settled =
        await Promise.allSettled(
          ids.map(
            id =>
              runAgent(
                env,
                id,
                project,
                goal,
                context
              )
          )
        );

      const reports =
        settled.map(
          (item, i) => {
            if (
              item.status ===
              'fulfilled'
            ) {
              return item.value;
            }

            const id = ids[i];
            const agent =
              AGENTS[id];

            return {
              id,
              name: agent.name,
              model:
                agent.label,
              content: '',
              error:
                item.reason
                  ?.message ||
                String(
                  item.reason ||
                  'Unknown error'
                ),
            };
          }
        );

      const successes =
        reports.filter(
          r => r.content
        );

      if (
        !successes.length
      ) {
        return json(
          {
            error:
              'All specialist model calls failed.',
            agents: reports,
          },
          502,
          origin
        );
      }

      let review = '';

      if (deep) {
        try {
          review =
            await targetedReview(
              env,
              project,
              goal,
              context,
              reports
            );
        } catch (e) {
          review =
            'Targeted cross-review failed: ' +
            (
              e?.message ||
              String(e)
            );
        }
      }

      let lead;

      try {
        lead =
          await synthesize(
            env,
            project,
            goal,
            context,
            reports,
            review
          );
      } catch (e) {
        return json(
          {
            error:
              'Lead synthesis failed: ' +
              (
                e?.message ||
                String(e)
              ),
            agents: reports,
            review,
          },
          502,
          origin
        );
      }

      return json(
        {
          ok: true,
          project,
          synthesis:
            lead.text,
          review,
          agents: reports,

          meta: {
            selectedAgents:
              ids.length,

            selectedAgentIds:
              ids,

            selectedAgentNames:
              ids.map(
                id =>
                  AGENTS[id].name
              ),

            deepCrossReview:
              deep,

            backend:
              'Cloudflare Workers AI',

            route:
              routeMeta,

            leadModel:
              lead.model,

            leadFallbackUsed:
              lead.fallbackUsed,

            memoryRewriteUsed:
              lead.memoryRewriteUsed,

            freePlanBehavior:
              'If the Cloudflare free AI allocation is exhausted, inference fails rather than silently switching to a paid model.',
          },
        },
        200,
        origin
      );

    } catch (e) {
      return json(
        {
          error:
            e?.message ||
            String(e),
        },
        500,
        origin
      );
    }
  },
};