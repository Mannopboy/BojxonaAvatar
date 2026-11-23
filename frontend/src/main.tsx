import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// /admin — bilim bazasi admin paneli (alohida bo'lak: kiosk yuklanishiga ta'sir qilmaydi). Qolgan hamma yo'l — kiosk avatar.
if (/^\/admin\/?$/.test(window.location.pathname)) {
  document.body.classList.add("admin-body");
  document.title = "Bilim bazasi — admin panel";
  void import("./admin/AdminApp").then(({ default: AdminApp }) =>
    root.render(
      <React.StrictMode>
        <AdminApp />
      </React.StrictMode>
    )
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
