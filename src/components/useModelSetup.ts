import { useEffect, useState } from "react";
import { createModelAdapters, modeFromLocation, type ModelSetup } from "../core/models";

/** Arma los adaptadores una vez al montar: en vivo, o replay con `?replay` / VITE_MODEL_MODE=replay. */
export function useModelSetup(): ModelSetup {
  const [setup, setSetup] = useState<ModelSetup>({ mode: "live", adapters: [], notes: [] });
  useEffect(() => {
    let active = true;
    void createModelAdapters({ mode: modeFromLocation(window.location.search) }).then((next) => {
      if (active) setSetup(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return setup;
}
