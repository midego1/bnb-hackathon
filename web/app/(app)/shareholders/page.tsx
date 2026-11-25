import { Shareholders } from "@/components/roles/Shareholders";
import { PageTitle } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getDictionary();
  return { title: t("holders.name") };
}

export default async function ShareholdersPage() {
  const t = await getDictionary();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("holders.title")}>{t("holders.intro")}</PageTitle>
      <Shareholders />
    </section>
  );
}
