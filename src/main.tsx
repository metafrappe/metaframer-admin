import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import App from "./App";
import "./styles.css";

const hashRouter = import.meta.env.VITE_ROUTER_MODE === "hash";
const Router = hashRouter ? HashRouter : BrowserRouter;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router basename={hashRouter ? undefined : import.meta.env.BASE_URL}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);
