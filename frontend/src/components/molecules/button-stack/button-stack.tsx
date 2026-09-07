/**
 * `ButtonStack` molecule — CoreUI Buttons doc's "Block buttons" section
 * (https://coreui.io/bootstrap/docs/components/buttons/#block-buttons).
 *
 * The source doc shows 4 near-identical examples — a `<div>` wrapping N
 * `Button`s, differing only by wrapper utility classes (full-width stack,
 * responsive stack, narrow centered stack, inline-end row). This molecule
 * dedupes those 4 into one `layout`-prop component per this story's
 * Decomposition-stage plan (item #8), rather than four copy-pasted wrapper
 * divs at every call site.
 *
 * `children` accepts any `ReactNode`, not specifically `Button` elements —
 * typical usage composes N × the sibling `atoms/button` `Button`, but
 * nothing here requires it.
 */
import { Children, cloneElement, isValidElement, ReactElement, ReactNode } from "react";

export type ButtonStackLayout = "stacked" | "stacked-responsive" | "stacked-narrow" | "inline-end";

const LAYOUT_CLASS: Record<ButtonStackLayout, string> = {
  stacked: "d-grid gap-2",
  "stacked-responsive": "d-grid gap-2 d-md-block",
  "stacked-narrow": "d-grid gap-2 col-6 mx-auto",
  "inline-end": "d-grid gap-2 d-md-flex justify-content-md-end",
};

export interface ButtonStackProps {
  layout?: ButtonStackLayout;
  children: ReactNode;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function ButtonStack({ layout = "stacked", children, className }: ButtonStackProps) {
  const items = Children.toArray(children);
  const wrapperClassName = [LAYOUT_CLASS[layout], className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClassName}>
      {items.map((child, index) => {
        const isLastChild = index === items.length - 1;
        if (layout !== "inline-end" || isLastChild || !isValidElement(child)) {
          return child;
        }
        // "inline-end" layout needs `me-md-2` spacing on every child but the
        // last (source HTML: `<button class="btn btn-primary me-md-2">`) —
        // the one genuinely index-dependent piece of this component; every
        // other layout is a fixed class string, no per-child computation.
        const element = child as ReactElement<{ className?: string }>;
        const existingClassName = element.props.className ?? "";
        return cloneElement(element, {
          className: [existingClassName, "me-md-2"].filter(Boolean).join(" "),
        });
      })}
    </div>
  );
}
