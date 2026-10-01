import { EnglishVariety, Exercise, ExerciseMode } from '../types';

type ExerciseSeed = {
  scenario: string;
  category: Exercise['category'];
  mode: ExerciseMode;
  coachTip: string;
  variations: Array<{
    title: string;
    description: string;
    prompt: string;
    referenceText?: string;
  }>;
};

const seeds: ExerciseSeed[] = [
  {
    scenario: 'Daily stand-up',
    category: 'meetings',
    mode: 'scripted',
    coachTip: 'Use a short pause after each idea. Clear pauses make status updates easier to follow.',
    variations: [
      { title: 'Yesterday / today', description: 'Give a concise team update.', prompt: 'Read this update with steady pace.', referenceText: 'Yesterday I finished the payment flow. Today I am testing the error states.' },
      { title: 'Progress update', description: 'State progress and your next action.', prompt: 'Read this update with clear emphasis on the key nouns.', referenceText: 'The dashboard is almost ready. I will share the final version tomorrow morning.' },
      { title: 'Blocker update', description: 'Name a blocker without sounding uncertain.', prompt: 'Read this update with a calm, direct delivery.', referenceText: 'I am blocked by the API response. I need access before I can complete the integration.' },
      { title: 'Priority update', description: 'Explain what you will focus on.', prompt: 'Read this update as if speaking to your team.', referenceText: 'My priority today is resolving the checkout issue and reviewing the new design.' },
      { title: 'Handoff update', description: 'Hand work to a teammate clearly.', prompt: 'Read this update with a useful pause before the request.', referenceText: 'The feature is ready for review. Could you test the mobile experience this afternoon?' },
    ],
  },
  {
    scenario: 'Project status',
    category: 'meetings',
    mode: 'roleplay',
    coachTip: 'Lead with the outcome, then add only the detail your listener needs.',
    variations: [
      { title: 'Green status', description: 'Give a confident project update.', prompt: 'Your manager asks: “How is the launch going?” Explain that delivery is on track, what is complete, and your next milestone.' },
      { title: 'Timeline change', description: 'Explain a revised timeline clearly.', prompt: 'Tell a stakeholder that testing needs two additional days. State the reason and the revised delivery date.' },
      { title: 'Decision request', description: 'Ask for a decision in a meeting.', prompt: 'Present two implementation options and ask your team to choose one by Friday.' },
      { title: 'Scope update', description: 'Set an expectation about scope.', prompt: 'Explain that one requested feature will move to the next release and say why.' },
      { title: 'Success recap', description: 'Summarize a completed milestone.', prompt: 'Give a thirty-second recap of a successful project milestone and thank the people involved.' },
    ],
  },
  {
    scenario: 'Risk escalation',
    category: 'meetings',
    mode: 'scripted',
    coachTip: 'Stress the risk, the impact, and the action. It makes escalation sound decisive rather than apologetic.',
    variations: [
      { title: 'Dependency risk', description: 'Escalate a dependency risk.', prompt: 'Read this escalation with controlled emphasis.', referenceText: 'There is a risk to the deadline because we are waiting for the vendor approval.' },
      { title: 'Quality concern', description: 'Raise a quality concern early.', prompt: 'Read this clearly and pause before the proposed action.', referenceText: 'I found a quality issue in the latest build. I recommend pausing the release until we verify the fix.' },
      { title: 'Capacity risk', description: 'Explain a resourcing issue.', prompt: 'Read this update in a calm, professional tone.', referenceText: 'We do not have enough engineering capacity to finish both priorities this week.' },
      { title: 'Customer impact', description: 'Describe user impact precisely.', prompt: 'Read this escalation with emphasis on the customer impact.', referenceText: 'If we ship this change today, some customers may not be able to complete their orders.' },
      { title: 'Mitigation plan', description: 'Pair a risk with a plan.', prompt: 'Read this as a concise recommendation.', referenceText: 'The risk is manageable if we add one day for testing and assign a second reviewer.' },
    ],
  },
  {
    scenario: 'Client meeting',
    category: 'meetings',
    mode: 'roleplay',
    coachTip: 'Slow slightly on names, dates, and next steps. Those are the details clients remember.',
    variations: [
      { title: 'Meeting opening', description: 'Open a client conversation warmly.', prompt: 'Welcome a client, introduce the purpose of the meeting, and preview the agenda.' },
      { title: 'Clarifying a need', description: 'Ask a useful discovery question.', prompt: 'Ask a client how their team currently handles a time-consuming workflow, then summarize what you heard.' },
      { title: 'Product value', description: 'Explain a benefit simply.', prompt: 'Describe one product benefit in plain language and connect it to a client problem.' },
      { title: 'Next steps', description: 'Close with ownership and timing.', prompt: 'Summarize agreed next steps, name the owner for each, and confirm the follow-up date.' },
      { title: 'Handling a concern', description: 'Respond to a concern professionally.', prompt: 'A client is concerned about implementation time. Acknowledge the concern and explain the support plan.' },
    ],
  },
  {
    scenario: 'Interview introduction',
    category: 'interviews',
    mode: 'roleplay',
    coachTip: 'Use a simple structure: present role, relevant experience, and why this opportunity matters.',
    variations: [
      { title: 'Tell me about yourself', description: 'Give a focused professional introduction.', prompt: 'Answer “Tell me about yourself” in about forty-five seconds.' },
      { title: 'Why this role?', description: 'Connect your experience to the opportunity.', prompt: 'Explain why you want this role and which part of your experience is most relevant.' },
      { title: 'Key strength', description: 'Describe a strength with evidence.', prompt: 'Name one professional strength and give a brief example of when it helped your team.' },
      { title: 'Career transition', description: 'Explain a transition confidently.', prompt: 'Explain why you are changing roles or industries, focusing on the skills you bring.' },
      { title: 'Value statement', description: 'Summarize what you offer.', prompt: 'In thirty seconds, explain the value you would bring to this team.' },
    ],
  },
  {
    scenario: 'Behavioral interview',
    category: 'interviews',
    mode: 'scripted',
    coachTip: 'For interview stories, pause between situation, action, and result so the listener can follow your impact.',
    variations: [
      { title: 'Team challenge', description: 'Tell a concise STAR story.', prompt: 'Read this answer with clear pauses between each sentence.', referenceText: 'My team had a tight deadline. I organized the work into smaller tasks, and we delivered the project on time.' },
      { title: 'Difficult decision', description: 'Show judgment and ownership.', prompt: 'Read this answer as a confident interview response.', referenceText: 'I had to choose between speed and quality. I proposed a smaller release, which protected the customer experience.' },
      { title: 'Feedback example', description: 'Show how you work with feedback.', prompt: 'Read this answer with natural emphasis on the result.', referenceText: 'A colleague gave me direct feedback. I changed my approach, and our collaboration became more effective.' },
      { title: 'Leadership example', description: 'Show influence without authority.', prompt: 'Read this answer as a concise story.', referenceText: 'I brought people together around a shared plan. The team agreed on priorities and completed the work early.' },
      { title: 'Learning example', description: 'Show how you learn quickly.', prompt: 'Read this answer with a steady pace.', referenceText: 'I needed to learn a new tool quickly. I practiced every day and used it successfully in a customer project.' },
    ],
  },
];

export function exercisesFor(variety: EnglishVariety): Exercise[] {
  return seeds.flatMap((seed, seedIndex) =>
    seed.variations.map((variation, variationIndex) => ({
      id: `${variety}-${seedIndex + 1}-${variationIndex + 1}`,
      targetVariety: variety,
      scenario: seed.scenario,
      category: seed.category,
      mode: seed.mode,
      title: variation.title,
      description: variation.description,
      prompt: variation.prompt,
      referenceText: variation.referenceText,
      coachTip: seed.coachTip,
      estimatedMinutes: seed.mode === 'scripted' ? 3 : 5,
      order: seedIndex * 5 + variationIndex + 1,
    })),
  );
}

export function nextExercise(variety: EnglishVariety, completedIds: string[]): Exercise {
  return exercisesFor(variety).find((exercise) => !completedIds.includes(exercise.id)) ?? exercisesFor(variety)[0];
}
