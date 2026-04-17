export function buildLeadMagnetPrompt(input: {
  title: string;
  h1: string;
  description: string;
  companyName: string;
  landingPageUrl: string;
}): string {
  return `You are writing a personalization variable for a cold email. The variable will be inserted into this sentence:
"I just came across {{Lead Magnet}} and thought it was really well done."

Based on the following landing page information, write a natural, conversational description of what this person offers:

Landing page title: ${input.title}
Landing page H1: ${input.h1}
Landing page description: ${input.description}
Company/Person name: ${input.companyName}
URL: ${input.landingPageUrl}

Rules:
- Start with "your" or "the"
- Maximum 15 words
- Lowercase, no quotes
- Sound natural when read in the sentence above
- Be specific to what they actually offer (mention the format: webinar, challenge, masterclass, course, etc.)
- If you can't determine what they offer, use a generic fallback like "your training program for coaches"

Respond with ONLY the personalization text, nothing else.`;
}
