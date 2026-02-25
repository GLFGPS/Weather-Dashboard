import { NextResponse } from "next/server";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const SYSTEM_PROMPT = `You are an internal weather-to-lead analyst for a lawn services growth team.
Prioritize practical, decision-oriented recommendations.
Always mention uncertainty when data is incomplete.
When discussing direct mail, focus on timing, channel mix, and weather constraints (snow, snow depth, temperature swings).`;

function extractOutputText(responseBody) {
  if (typeof responseBody?.output_text === "string" && responseBody.output_text) {
    return responseBody.output_text.trim();
  }

  const chunks = [];
  for (const outputItem of responseBody?.output || []) {
    for (const contentItem of outputItem?.content || []) {
      if (contentItem?.type === "output_text" && contentItem.text) {
        chunks.push(contentItem.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

export async function POST(request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY is not configured. Add it in your Vercel project environment variables.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();
    const question = body?.question?.trim();
    if (!question) {
      return NextResponse.json(
        { error: "A question is required." },
        { status: 400 },
      );
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const serializedContext = JSON.stringify(
      {
        weatherContext: body?.weatherContext || null,
        analysisContext: body?.analysisContext || null,
      },
      null,
      2,
    ).slice(0, 20000);

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        store: false,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Question:\n${question}\n\nContext:\n${serializedContext}`,
              },
            ],
          },
        ],
      }),
    });

    const responseBody = await response.json();
    if (!response.ok) {
      const message =
        responseBody?.error?.message || "OpenAI request failed unexpectedly.";
      throw new Error(message);
    }

    const answer = extractOutputText(responseBody);
    return NextResponse.json({
      answer: answer || "No response text was returned.",
      model: responseBody.model,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unexpected chat route failure." },
      { status: 500 },
    );
  }
}
