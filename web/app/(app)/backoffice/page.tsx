import { BackOffice } from "@/components/roles/BackOffice";
import { PageTitle } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getDictionary();
  return { title: t("backoffice.name") };
}

export default async function BackOfficePage() {
  const t = await getDictionary();
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <PageTitle title={t.h("backoffice.title")}>{t("backoffice.intro")}</PageTitle>
      <BackOffice />
    </section>
  );
}
