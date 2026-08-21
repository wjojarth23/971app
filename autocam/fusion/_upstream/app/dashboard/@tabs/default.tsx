import { redirect } from "next/navigation";
export default function DefaultTab() {
  redirect("/dashboard/plates");
  return null;
}
