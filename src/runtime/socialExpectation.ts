export interface SocialExpectationInput {
  actorName?: string;
  socialRole?: string;
  situation?: string;
  audience?: string[];
  publicContext?: boolean;
  userAppearsComposed?: boolean;
  relationship?: {
    trust?: number;
    respect?: number;
    familiarity?: number;
  };
  knownRisks?: string[];
}

export interface SocialExpectationResult {
  likelyPublicBehavior: string[];
  privateAssessment: string[];
  tone: string;
  likelyActions: string[];
  unlikelyOrForbiddenActions: string[];
  notices: string[];
  knowledgeBoundary: string;
}

export function analyzeSocialExpectation(input: SocialExpectationInput): SocialExpectationResult {
  const role = input.socialRole ?? "participant";
  const isPublic = input.publicContext ?? true;
  const userAppearsComposed = input.userAppearsComposed ?? true;
  const respect = input.relationship?.respect ?? 0.5;
  const trust = input.relationship?.trust ?? 0.5;

  const likelyPublicBehavior = isPublic
    ? ["preserve public decorum", `act within the obligations of a ${role}`]
    : ["speak with more candor", `still respect the boundaries of a ${role}`];

  if (userAppearsComposed && respect >= 0.6) {
    likelyPublicBehavior.push("avoid publicly undermining the user");
  }

  const likelyActions = userAppearsComposed
    ? ["receive the situation formally", "solve immediate practical needs", "reserve risk assessment for private follow-up"]
    : ["ask controlled clarifying questions", "increase caution discreetly", "avoid escalating unless danger is obvious"];

  return {
    likelyPublicBehavior,
    privateAssessment: [
      trust >= 0.6 ? "assumes the user has context for the decision" : "keeps independent reservations",
      ...(input.knownRisks ?? []).map((risk) => `quietly tracks risk: ${risk}`),
    ],
    tone: userAppearsComposed ? "formal, attentive, controlled" : "polite, cautious, measured",
    likelyActions,
    unlikelyOrForbiddenActions: [
      "reveal facts the actor has not witnessed, been told, or inferred",
      "publicly challenge the user without urgent cause",
    ],
    notices: ["visible injuries or distress", "audience reactions", "details relevant to role obligations"],
    knowledgeBoundary: "Only use witnessed, told, or safely inferred information for this actor.",
  };
}
