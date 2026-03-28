import { PrismaClient, RoleStatus } from "@prisma/client";

const prisma = new PrismaClient();

const roles = [
  {
    slug: "ai-product-operator",
    title: "AI Product Operator",
    team: "Product",
    location: "Nepal",
    remoteStatus: "Remote",
    experienceLevel: "Senior / Lead",
    summary:
      "Build internal AI systems that automate manual work across Product, Operations, Sales, and Finance.",
    responsibilities: [
      "Ship full-stack internal tools used by non-technical teammates every day.",
      "Design multi-step AI workflows for document analysis, research, and decision support.",
      "Integrate systems across Slack, email, calendars, CRMs, and internal databases.",
      "Own delivery from prototype to deployment, monitoring, and iteration.",
    ],
    requirements: [
      "2+ years building with TypeScript, Python, or both.",
      "Strong experience with LLM APIs, structured outputs, and prompt design.",
      "Comfort with SQL, REST APIs, and webhook-based integrations.",
      "Bias toward shipping reliable tools quickly.",
    ],
  },
  {
    slug: "ai-operations-analyst",
    title: "AI Operations Analyst",
    team: "Operations",
    location: "Remote - Global",
    remoteStatus: "Remote",
    experienceLevel: "Mid / Senior",
    summary:
      "Improve operational throughput by building AI-assisted workflows for payroll, onboarding, and compliance support.",
    responsibilities: [
      "Map operational bottlenecks and convert them into usable tooling.",
      "Automate structured data collection and exception handling.",
      "Create dashboards and alerts that keep operators out of spreadsheets.",
      "Partner with Finance and HR stakeholders on workflow design.",
    ],
    requirements: [
      "Experience building internal tools and workflow automations.",
      "Strong product judgment and comfort with ambiguity.",
      "Ability to translate messy processes into durable systems.",
      "Clear written communication and strong follow-through.",
    ],
  },
  {
    slug: "founding-ai-workflow-engineer",
    title: "Founding AI Workflow Engineer",
    team: "Platform",
    location: "United States",
    remoteStatus: "Hybrid",
    experienceLevel: "Senior",
    summary:
      "Own the AI workflow substrate that powers internal copilots, document pipelines, and decision systems.",
    responsibilities: [
      "Build reusable services for AI orchestration, observability, and guardrails.",
      "Develop integrations with third-party systems and internal APIs.",
      "Improve reliability, evaluations, and operator trust in AI-assisted workflows.",
      "Support rapid experimentation without sacrificing maintainability.",
    ],
    requirements: [
      "Deep experience building backend systems and APIs.",
      "Hands-on LLM product work with evaluations and fallback design.",
      "Comfort designing schemas and state machines.",
      "Ability to simplify complex workflows into clear abstractions.",
    ],
  },
];

async function main() {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {
        ...role,
        status: RoleStatus.OPEN,
      },
      create: {
        ...role,
        status: RoleStatus.OPEN,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
