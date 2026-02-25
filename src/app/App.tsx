import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/auth-context";
import { InventoryProvider } from "./context/inventory-context";
import { router } from "./router";

export default function App() {
  return (
    <AuthProvider>
      <InventoryProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" />
      </InventoryProvider>
    </AuthProvider>
  );
}
