import { useTransition } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

export function useNavigateWithTransition() {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  function navigateWithTransition(to: To, options?: NavigateOptions) {
    startTransition(() => { navigate(to, options); });
  }

  return { navigate: navigateWithTransition, isPending };
}
