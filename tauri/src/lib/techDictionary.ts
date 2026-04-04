export interface TechDefinition {
  word: string;
  definition: string;
}

export const TECH_DICTIONARY: Record<string, TechDefinition> = {
  llm: {
    word: "LLM",
    definition: "Large Language Model. A type of AI trained on vast amounts of text to understand and generate human-like language.",
  },
  rag: {
    word: "RAG",
    definition: "Retrieval-Augmented Generation. A technique that grants AI models access to external data to improve factual accuracy.",
  },
  embedding: {
    word: "Embedding",
    definition: "A numerical representation of text that captures its meaning, allowing computers to understand relationships between words.",
  },
  transformer: {
    word: "Transformer",
    definition: "The core architecture behind modern AI (like GPT), using 'attention' to process language in parallel.",
  },
  token: {
    word: "Token",
    definition: "The basic unit of text processed by an AI—can be a word, part of a word, or even punctuation.",
  },
  hallucination: {
    word: "Hallucination",
    definition: "When an AI confidently generates false or fabricated information not present in its training data or sources.",
  },
  quantization: {
    word: "Quantization",
    definition: "A process to make AI models smaller and faster by reducing the precision of their internal numbers.",
  },
  attention: {
    word: "Attention",
    definition: "A mechanism that allows AI to focus on the most relevant parts of an input when generating a response.",
  },
  inference: {
    word: "Inference",
    definition: "The process of using a trained AI model to generate a response or make a prediction.",
  },
  "fine-tuning": {
    word: "Fine-tuning",
    definition: "Training a pre-existing AI model on a specific dataset to adapt it for a particular task or style.",
  },
  parameters: {
    word: "Parameters",
    definition: "The internal variables (weights) an AI model learns during training, determining its knowledge and behavior.",
  },
  temperature: {
    word: "Temperature",
    definition: "A setting that controls the randomness of AI responses. Lower is more focused; higher is more creative.",
  },
  context: {
    word: "Context",
    definition: "The information (previous messages, documents) an AI 'remembers' or considers when generating its next response.",
  },
  prompt: {
    word: "Prompt",
    definition: "The input text or instructions provided to an AI to guide its response generation.",
  },
  weights: {
    word: "Weights",
    definition: "The numerical values in an AI's neural network that determine how much influence different inputs have.",
  },
};

export function lookupTechTerm(word: string): TechDefinition | null {
  const normalized = word.toLowerCase().trim();
  return TECH_DICTIONARY[normalized] || null;
}
