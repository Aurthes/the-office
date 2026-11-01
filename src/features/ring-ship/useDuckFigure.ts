import { useEffect, useMemo } from "react";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { createDuckCrewFigure } from "./duckCrewFigure";

export function useDuckFigure(appearance?: DuckAppearance) {
  const appearanceKey = JSON.stringify(normalizeDuckAppearance(appearance));
  const figure = useMemo(() => createDuckCrewFigure(JSON.parse(appearanceKey) as DuckAppearance), [appearanceKey]);
  useEffect(() => () => figure.dispose(), [figure]);
  return figure;
}
