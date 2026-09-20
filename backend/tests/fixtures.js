export const MEMO = `FINAL RECOMMENDATION
Keep the project focused on a small, reversible pilot with explicit acceptance criteria.
WHY THIS WINS
A bounded pilot makes the remaining assumptions visible and gives the owner a concrete decision.
EVIDENCE STATUS
The goal and locked context are supplied by the user. Specialist opinions are proposals, not independent evidence.
WHAT THE COUNCIL DISAGREED ABOUT
Preserve the objection that the operating burden could outweigh the expected benefit.
RISKS / UNKNOWNS
Actual demand and the time required remain unknown until measured.
THREE MOST IMPORTANT IMPROVEMENTS OR DECISIONS
Choose the acceptance threshold, the pilot owner, and the stopping condition.
NEXT CONCRETE STEP
Write the pilot acceptance criteria and schedule a bounded evaluation.`;

export function fakeAI(overrides = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (overrides.run) return overrides.run(model, input, calls);
      const system = input.messages[0].content;
      if (/Lead|senior decision memo/i.test(system)) return { response: MEMO };
      if (/Targeted Review/.test(system)) return { response: 'MATERIAL DISAGREEMENTS\nThe minority objection remains unresolved.\nUNSUPPORTED CLAIMS\nNone verified.\nMINORITY VIEW WORTH PRESERVING\nOperating burden.\nWHAT LEAD MUST RESOLVE\nPilot threshold.' };
      return { response: `STATUS: ANSWERED\nFACTS FROM PROVIDED BRIEF\n${system}\nINFERENCES\nDemand needs measurement.\nIDEAS / RECOMMENDATIONS\nRun a bounded pilot.\nRISKS / OBJECTIONS\nOperating burden.\nUNKNOWNS TO VERIFY\nDemand.\nPOINT TO CHALLENGE\nExpected benefit.\nNEXT ACTION\nChoose acceptance criteria.` };
    }
  };
}
export const ORIGIN = 'https://counterpart-ai-team.vercel.app';
export function request(body = {}, path = '/api/team', method = 'POST', origin = ORIGIN) {
  return new Request(`https://counterpart.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ project: 'Counterpart', goal: 'Plan a useful software pilot', ...body }) } : {})
  });
}
