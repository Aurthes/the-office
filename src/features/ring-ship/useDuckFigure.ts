import { useEffect, useMemo } from "react";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { createDuckCrewFigure } from "./duckCrewFigure";

export function useDuckFigure(appearance?: DuckAppearance) {
  const { featherColor, billColor, billShape, billScale, headwear, outfit, outfitColor, bodyWidth, bodyDepth, bodyHeight, eyeSpacing, eyeHeight } = normalizeDuckAppearance(appearance);
  const figure = useMemo(() => createDuckCrewFigure({ featherColor, billColor, billShape, billScale, headwear, outfit, outfitColor, bodyWidth, bodyDepth, bodyHeight, eyeSpacing, eyeHeight }),
    [featherColor, billColor, billShape, billScale, headwear, outfit, outfitColor, bodyWidth, bodyDepth, bodyHeight, eyeSpacing, eyeHeight]);
  useEffect(() => () => figure.dispose(), [figure]);
  return figure;
}
