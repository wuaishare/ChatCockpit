import type { ReactNode } from "react";
import { Text } from "@lobehub/ui";
import { AppstoreOutlined } from "@ant-design/icons";

interface SectionCardProps {
  title: string;
  description?: string;
  extra?: ReactNode;
  tone?: "default" | "hero" | "soft";
  children: ReactNode;
}

export function SectionCard({
  title,
  description,
  extra,
  tone = "default",
  children
}: SectionCardProps) {
  return (
    <section className={`panel section-card section-card--${tone}`}>
      <header className="section-card__header">
        <div className="section-card__title-wrap">
          <span className="section-card__icon" aria-hidden="true">
            <AppstoreOutlined />
          </span>
          <div>
            <Text as="div" className="section-card__title">
              {title}
            </Text>
            {description ? (
              <Text as="div" className="section-card__description" type="secondary">
                {description}
              </Text>
            ) : null}
          </div>
        </div>
        {extra ? <div className="section-card__extra">{extra}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
