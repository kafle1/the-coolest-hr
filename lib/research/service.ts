import { getAiService } from "@/lib/ai/service";
import { fetchGithubEvidence } from "@/lib/github/service";

function buildSubmittedSources(input: {
  linkedinUrl: string;
  portfolioUrl?: string | null;
}) {
  return [
    {
      label: "Submitted LinkedIn profile",
      url: input.linkedinUrl,
    },
    ...(input.portfolioUrl
      ? [
          {
            label: "Submitted portfolio or GitHub",
            url: input.portfolioUrl,
          },
        ]
      : []),
  ];
}

export async function buildCandidateResearch(input: {
  fullName: string;
  roleTitle: string;
  linkedinUrl: string;
  portfolioUrl?: string | null;
  resumeSummary: string;
}) {
  const ai = getAiService();
  const githubEvidence = await fetchGithubEvidence(input.portfolioUrl);
  const research = await ai.researchCandidate({
    ...input,
    resumeSummary: [input.resumeSummary, githubEvidence.summary]
      .filter(Boolean)
      .join("\n"),
  });

  const sources = [
    ...buildSubmittedSources(input),
    ...research.sources,
    ...githubEvidence.sources,
  ].filter(
    (source, index, list) =>
      list.findIndex((item) => item.url === source.url) === index,
  );

  return {
    ...research,
    linkedinSummary:
      research.linkedinSummary ??
      (input.linkedinUrl
        ? "Submitted LinkedIn profile was included in the research review."
        : null),
    githubSummary: research.githubSummary ?? githubEvidence.summary,
    sources,
  };
}
