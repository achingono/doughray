import {
  LayoutDashboard,
  Landmark,
  ArrowRightLeft,
  Building,
  PiggyBank,
  Target,
  FileText,
  Settings,
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import brandMark from "@/assets/doughray-mark.png";
import { BRAND } from "@/lib/brand";

const navItems = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/" },
  { title: "Holdings", icon: Landmark, path: "/holdings" },
  { title: "Transactions", icon: ArrowRightLeft, path: "/transactions" },
  { title: "Assets", icon: Building, path: "/assets" },
  { title: "Budgets", icon: PiggyBank, path: "/budgets" },
  { title: "Goals", icon: Target, path: "/goals" },
  { title: "Reports", icon: FileText, path: "/reports" },
  { title: "Settings", icon: Settings, path: "/settings" },
];

export function AppSidebar() {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border/60 px-5 py-4">
        <Link to="/" className="flex items-center gap-3" onClick={() => setOpenMobile(false)}>
          <img
            src={brandMark}
            alt={`${BRAND.name} mark`}
            className="h-10 w-10 rounded-xl border border-sidebar-border/70 object-cover"
          />
          <div>
            <h1 className="text-lg font-semibold leading-none tracking-tight">{BRAND.name}</h1>
            <p className="text-xs text-muted-foreground">{BRAND.tagline}</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.path}
                  >
                    <Link to={item.path} onClick={() => setOpenMobile(false)} className="w-full">
                      <motion.div 
                        whileHover={{ x: 5 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-2"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </motion.div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground text-center">
          {BRAND.name} {BRAND.version}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
