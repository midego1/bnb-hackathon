"use client";

/*
 * Vercel AI Elements (ai-elements@1.9.1 CLI, shadcn registry), trimmed for KeyScrow: no `ai` package (local
 * types), no streamdown / shiki / motion (the Cloudflare Worker has a 3 MiB budget). Answers render with
 * components/assistant/Markdown.tsx. Here: status colours are our tokens, input/output are plain <pre> JSON (the
 * upstream shiki CodeBlock is gone), and the header takes an optional icon and status label.
 */

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import type { ToolState } from "./confirmation";

export type { ToolState } from "./confirmation";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  /** Replaces the wrench. */
  icon?: LucideIcon;
  /** Replaces the default label of the status badge. */
  statusLabel?: ReactNode;
  /** No chevron (a step without details to open). */
  static?: boolean;
} & (
  | { type: `tool-${string}`; state: ToolState; toolName?: never }
  | { type: "dynamic-tool"; state: ToolState; toolName: string }
);

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-(--assistant-waiting)" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-info" />,
  "input-available": <ClockIcon className="size-4 animate-pulse text-(--assistant-reading)" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-success" />,
  "output-denied": <XCircleIcon className="size-4 text-subtle" />,
  "output-error": <XCircleIcon className="size-4 text-danger" />,
};

export const getStatusBadge = (status: ToolState, label?: ReactNode) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {label ?? statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  icon: Icon = WrenchIcon,
  statusLabel,
  static: isStatic,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      disabled={isStatic}
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3 text-left disabled:cursor-default",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state, statusLabel)}
      </div>
      {!isStatic && (
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      )}
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

const Json = ({ value }: { value: unknown }) => (
  <pre className="overflow-x-auto p-3 font-mono text-xs">
    {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
  </pre>
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <Json value={input} />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  const Output =
    isValidElement(output) || typeof output === "number" ? (
      <div>{output as ReactNode}</div>
    ) : (
      <Json value={output} />
    );

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-danger-soft text-danger-fg"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {output ? Output : null}
      </div>
    </div>
  );
};
