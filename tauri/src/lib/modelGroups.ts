export interface ModelGroupMeta {
  key: string;
  label: string;
  order: number;
}

export function getModelGroupMeta(provider?: string | null): ModelGroupMeta {
  if (!provider || provider === "ollama") {
    return { key: "ollama", label: "Ollama", order: 0 };
  }

  if (provider.startsWith("web_")) {
    return { key: "web-ai", label: "Web AI", order: 1 };
  }

  if (provider === "mlx") {
    return { key: "mlx", label: "MLX", order: 2 };
  }

  if (provider === "llamacpp") {
    return { key: "llamacpp", label: "llama.cpp", order: 3 };
  }

  return { key: "other", label: "Other", order: 4 };
}
