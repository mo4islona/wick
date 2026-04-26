/** Font family and base font size used across the chart. */
export interface Typography {
  /** CSS `font-family` stack applied to all text rendered by the chart. */
  fontFamily: string;
  /** Base body font size — titles, infobar, pie tooltip/legend default to this. */
  fontSize: number;
}

/**
 * Complete visual theme for a chart instance.
 * Controls colors for every visual element: background, series, axes, crosshair, tooltip, etc.
 */
export interface ChartTheme {
  /** Page/container background */
  background: string;
  /** Chart area gradient [top, bottom] — subtle vignette for depth */
  chartGradient: [string, string];
  /** Font family and base size used across the chart's text. */
  typography: Typography;

  /** Grid line appearance in the chart area. */
  grid: {
    /** Grid line stroke colour. */
    color: string;
    /** Grid line dash pattern. */
    style: 'solid' | 'dashed' | 'dotted';
  };

  /**
   * OHLC candlestick colors. `wick` defaults to `body` in {@link createTheme}
   * when omitted, so most presets only need to set the body colors.
   *
   * `body` shape encodes the fill: a single color renders flat; a
   * `[top, bottom]` tuple renders a 2-stop vertical gradient. Presets that
   * want the subtle lightened/darkened look pass `autoGradient(color)`.
   */
  candlestick: {
    /** Bullish candle (close ≥ open). */
    up: {
      /** Body fill — single colour for flat, `[top, bottom]` tuple for a 2-stop vertical gradient. */
      body: string | [string, string];
      /** Wick stroke colour. */
      wick: string;
    };
    /** Bearish candle (close < open). */
    down: {
      /** Body fill — single colour for flat, `[top, bottom]` tuple for a 2-stop vertical gradient. */
      body: string | [string, string];
      /** Wick stroke colour. */
      wick: string;
    };
  };

  /** Default line series appearance including area gradient fill. */
  line: {
    /** Stroke colour of the line. */
    color: string;
    /** Stroke width in CSS pixels. */
    width: number;
    /** Top stop of the area-fill vertical gradient (closest to the line). */
    areaTopColor: string;
    /** Bottom stop of the area-fill vertical gradient (closest to the X axis). */
    areaBottomColor: string;
  };

  /** Color palette for multi-series charts (stacked bars, overlays). */
  seriesColors: string[];

  /** Bollinger band / envelope fill colors. */
  bands: {
    /** Fill for the upper band region (above the middle band). */
    upper: string;
    /** Fill for the lower band region (below the middle band). */
    lower: string;
  };

  /** Crosshair line and axis label styling. */
  crosshair: {
    /** Stroke colour of the crosshair lines. */
    color: string;
    /** Background fill of the X/Y axis label pills shown at the crosshair position. */
    labelBackground: string;
    /** Text colour inside the crosshair axis label pills. */
    labelTextColor: string;
  };

  /**
   * Axis tick styling. `fontSize` and `textColor` are the shared defaults used
   * for both X and Y, as well as non-axis label surfaces (legend, crosshair
   * labels, sparkline ticks). Set `x` / `y` only when a specific axis needs to
   * diverge.
   */
  axis: {
    /** Default tick-label font size shared by both axes. */
    fontSize: number;
    /** Default tick-label colour shared by both axes. */
    textColor: string;
    /** Override the shared defaults on the X axis only. */
    x?: {
      /** X-axis tick-label font size. Falls back to `axis.fontSize`. */
      fontSize?: number;
      /** X-axis tick-label colour. Falls back to `axis.textColor`. */
      textColor?: string;
    };
    /** Override the shared defaults on the Y axis only. */
    y?: {
      /** Y-axis tick-label font size. Falls back to `axis.fontSize`. */
      fontSize?: number;
      /** Y-axis tick-label colour. Falls back to `axis.textColor`. */
      textColor?: string;
    };
  };

  /** Floating label shown at the current value level on the Y axis. */
  yLabel: {
    /** Font size of the value text inside the floating Y label. */
    fontSize: number;
    /** Pill background when the latest delta is positive. */
    upBackground: string;
    /** Pill background when the latest delta is negative. */
    downBackground: string;
    /** Pill background when the latest delta is zero / unknown. */
    neutralBackground: string;
    /** Text colour inside the floating Y label pill. */
    textColor: string;
  };

  /** Hover tooltip styling. */
  tooltip: {
    /** Tooltip body font size. */
    fontSize: number;
    /** Tooltip background fill. */
    background: string;
    /** Tooltip text colour. */
    textColor: string;
    /** Tooltip outer border colour. */
    borderColor: string;
  };

  /**
   * Navigator strip shown below the main chart — a miniature overview with a
   * draggable window indicating the visible range.
   *
   * The `candlestick` shape mirrors the root {@link ChartTheme.candlestick}
   * (including `[top, bottom]` gradient tuples) so candle-type mini views can
   * share colors with the main plot.
   */
  navigator: {
    /** Default height of the navigator strip in CSS pixels. */
    height: number;
    /** Strip background (behind the miniature series). */
    background: string;
    /** Color used for the strip's top + bottom inner-shadow separators. */
    borderColor: string;
    /** Line / close-price miniature color and geometry. */
    line: {
      /** Stroke colour of the miniature line. */
      color: string;
      /** Stroke width of the miniature line in CSS pixels. */
      width: number;
      /** Top stop of the miniature area-fill gradient. */
      areaTopColor: string;
      /** Bottom stop of the miniature area-fill gradient. */
      areaBottomColor: string;
    };
    /** Colors for candlestick-type miniature rendering. */
    candlestick: {
      /** Bullish miniature candle (close ≥ open). */
      up: {
        /** Body fill — single colour for flat, `[top, bottom]` tuple for a vertical gradient. */
        body: string | [string, string];
        /** Wick stroke colour. */
        wick: string;
      };
      /** Bearish miniature candle (close < open). */
      down: {
        /** Body fill — single colour for flat, `[top, bottom]` tuple for a vertical gradient. */
        body: string | [string, string];
        /** Wick stroke colour. */
        wick: string;
      };
    };
    /** The draggable visible-range window indicator. */
    window: {
      /** Fill inside the visible-range window. Usually a translucent tint. */
      fill: string;
      /** Stroke colour around the window. */
      border: string;
      /** Stroke width of the window border in CSS pixels. */
      borderWidth: number;
    };
    /** Left/right resize handles on the window edges. */
    handle: {
      /** Stroke colour of the handle marker. */
      color: string;
      /** Handle marker width in CSS pixels. */
      width: number;
    };
    /** Dim overlay covering the regions outside the window. */
    mask: {
      /** Fill of the dim overlay applied to regions outside the window. */
      fill: string;
    };
  };
}
