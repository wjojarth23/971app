"use client";
import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import Link from "next/link";

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const logout = async () => await authClient.signOut({
    fetchOptions: {
      onSuccess: () => router.push("/login")
    }
  })
  return <>
    <nav className="navbar navbar-expand-lg navbar-dark gh-header border-bottom">
      <div className="container-fluid">
        <Link className="navbar-brand gh-brand" href="/">AutoCAM</Link>
        <div className="d-flex gap-3">
          <Link className="nav-link gh-link" href="/settings">Settings</Link>
          <button className="nav-link gh-link" onClick={logout}>Logout</button>
        </div>
      </div>
    </nav>
    <div className="container-fluid py-3">
      {/* {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
          <div class="container">
            {% for category, message in messages %}
            <div class="alert alert-{{ 'warning' if category=='danger' else category }} gh-alert">
              {{ message }}
            </div>
            {% endfor %}
          </div>
          {% endif %}
          {% endwith %} */}
      {children}
    </div></>
}