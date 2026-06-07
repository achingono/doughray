import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { SmoothScroll } from "./SmoothScroll";
import { CustomCursor } from "./CustomCursor";
import { Preloader } from "./Preloader";
import { motion, AnimatePresence } from "framer-motion";

export function AppLayout() {
  const location = useLocation();
  return (
    <SmoothScroll>
      <Preloader />
      <CustomCursor />
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <AnimatePresence mode="wait">
            <motion.main 
              key={location.pathname}
              className="flex-1 overflow-auto p-4 md:p-6 lg:p-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </SidebarInset>
      </SidebarProvider>
    </SmoothScroll>
  );
}
