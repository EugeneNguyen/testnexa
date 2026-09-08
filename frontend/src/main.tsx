import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// AdminLTE v4 is the project's design system (ADR-0042, superseding ADR-0012's
// CoreUI choice) — imported once here, as the single stylesheet entry point.
//
// Deliberately NOT accompanied by a `bootstrap/dist/css/bootstrap.min.css`
// import, even though `bootstrap` is a real dependency: AdminLTE's own
// `adminlte.scss` `@import`s every Bootstrap partial, so the shipped
// `adminlte.min.css` ALREADY CONTAINS the whole of Bootstrap 5 (verified
// against the vendored file — `.btn-primary`, `.form-control`,
// `.modal-dialog`, `.table`, `.col-md-6`, `.d-flex`, `.badge` and
// `.pagination` are all in it). Importing Bootstrap separately would ship
// ~232KB twice and put two copies of every rule in the cascade. The
// `bootstrap` package stays installed solely to satisfy AdminLTE's declared
// `peerDependencies` entry.
import "admin-lte/dist/css/adminlte.min.css";
// Font Awesome Free is the project's icon library (ADR-0042), replacing
// `@coreui/icons`/`@coreui/icons-react`. Icons render as CSS classes on an
// `<i>` element (`fa-solid fa-house`), not as React components — so there is
// no icon component to import, only this stylesheet.
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
