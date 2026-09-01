import {
  ApiOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  DashboardOutlined,
  DesktopOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  GlobalOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import { Button, Drawer, Menu, type MenuProps } from "antd";
import { useMemo, useState } from "react";
import chatCockpitLogo from "../../../assets/brand/chatcockpit-app-icon.svg";
import type { AppViewKey } from "../navigation";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "chatcockpit-sidebar-collapsed";

interface AppSidebarLabels {
  title: string;
  workspaceNavigation: string;
  operationsNavigation: string;
  systemNavigation: string;
  dashboard: string;
  projects: string;
  resources: string;
  devices: string;
  jobs: string;
  publicAccess: string;
  integrations: string;
  collapseNavigation: string;
  expandNavigation: string;
  closeNavigation: string;
}

interface AppSidebarProps {
  activeView: AppViewKey;
  labels: AppSidebarLabels;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNavigate: (view: AppViewKey) => void;
}

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Local preference persistence is best-effort only.
  }
}

export function AppSidebar({
  activeView,
  labels,
  mobileOpen,
  onMobileClose,
  onNavigate
}: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const menuItems = useMemo<MenuProps["items"]>(
    () => [
      { key: "dashboard", icon: <DashboardOutlined />, label: labels.dashboard },
      {
        type: "group",
        label: labels.workspaceNavigation,
        children: [
          { key: "projects", icon: <ApartmentOutlined />, label: labels.projects },
          { key: "resources", icon: <AppstoreOutlined />, label: labels.resources }
        ]
      },
      {
        type: "group",
        label: labels.operationsNavigation,
        children: [
          { key: "devices", icon: <DesktopOutlined />, label: labels.devices },
          { key: "jobs", icon: <UnorderedListOutlined />, label: labels.jobs }
        ]
      },
      {
        type: "group",
        label: labels.systemNavigation,
        children: [
          { key: "publicAccess", icon: <GlobalOutlined />, label: labels.publicAccess },
          { key: "integrations", icon: <ApiOutlined />, label: labels.integrations }
        ]
      }
    ],
    [labels]
  );

  const navigate = (key: string) => {
    onNavigate(key as AppViewKey);
    onMobileClose();
  };

  const sidebarContent = (compact: boolean) => (
    <>
      <div className="app-sidebar__brand">
        <img className="app-sidebar__logo" src={chatCockpitLogo} alt="" aria-hidden="true" />
        {compact ? null : <strong className="app-sidebar__brand-text">{labels.title}</strong>}
      </div>
      <Menu
        className="app-sidebar__menu"
        mode="inline"
        inlineCollapsed={compact}
        selectedKeys={[activeView]}
        items={menuItems}
        onClick={({ key }) => navigate(String(key))}
      />
    </>
  );

  return (
    <>
      <aside className={`app-sidebar${collapsed ? " app-sidebar--collapsed" : ""}`}>
        <div className="app-sidebar__body">{sidebarContent(collapsed)}</div>
        <div className="app-sidebar__footer">
          <Button
            type="text"
            className="app-sidebar__collapse"
            aria-label={collapsed ? labels.expandNavigation : labels.collapseNavigation}
            icon={collapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              persistCollapsed(next);
            }}
          >
            {collapsed ? null : labels.collapseNavigation}
          </Button>
        </div>
      </aside>

      <Drawer
        className="app-sidebar-drawer"
        placement="left"
        width={284}
        open={mobileOpen}
        onClose={onMobileClose}
        title={null}
        closeIcon={false}
        styles={{ body: { padding: 0 } }}
      >
        <div className="app-sidebar app-sidebar--mobile">
          <div className="app-sidebar__body">{sidebarContent(false)}</div>
          <div className="app-sidebar__footer">
            <Button type="text" block onClick={onMobileClose}>
              {labels.closeNavigation}
            </Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
