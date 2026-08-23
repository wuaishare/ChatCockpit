import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  "aria-label": string;
  content: string | (() => string);
}

export function CopyButton({ "aria-label": ariaLabel, content }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    const value = typeof content === "function" ? content() : content;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Tooltip title={ariaLabel}>
      <Button
        aria-label={ariaLabel}
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={() => void copy()}
        size="small"
        type="text"
      />
    </Tooltip>
  );
}
