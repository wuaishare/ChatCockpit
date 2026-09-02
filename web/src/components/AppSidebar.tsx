import {
  ApiOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  CloudServerOutlined,
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
import type { BrowserNavigationLeafKey } from "../navigation";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "chatcockpit-sidebar-collapsed";

interface AppSidebarLabels {
  title: string;
  dashboard: string;
  projects: string;
  workNavigation: string;
  workCoordination: string;
  jobs: string;
  approvals: string;
  executionNavigation: string;
  runtime: string;
  resources: string;
  devices: string;
  connectionsNavigation: string;
  publicAccess: string;
  integrations: string;
  collapseNavigation: string;
  expandNavigation: string;
  closeNavigation: string;
}

interface AppSidebarProps {
  activeNavigationKey: BrowserNavigationLeafKey;
  labels: AppSidebarLabels;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNavigate: (key: BrowserNavigationLeafKey) => void;
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
  activeNavigationKey,
  labels,
  mobileOpen,
  onMobileClose,
  onNavigate
}: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const menuItems = useMemo<MenuProps["items"]>(
    () => [
      { key: "overview", icon: <DashboardOutlined />, label: labels.dashboard },
      { key: "projects", icon: <ApartmentOutlined />, label: labels.projects },
      {
        type: "group",
        label: labels.workNavigation,
        children: [
          { key: "workTasks", icon: <CheckSquareOutlined />, label: labels.workCoordination },
          { key: "workJobs", icon: <UnorderedListOutlined />, label: labels.jobs },
          { key: "workApprovals", icon: <AuditOutlined />, label: labels.approvals }
        ]
      },
      {
        type: "group",
        label: labels.executionNavigation,
        children: [
          { key: "runtime", icon: <CloudServerOutlined />, label: labels.runtime },
          { key: "resources", icon: <AppstoreOutlined />, label: labels.resources },
          { key: "devices", icon: <DesktopOutlined />, label: labels.devices }
        ]
      },
      {
        type: "group",
        label: labels.connectionsNavigation,
        children: [
          { key: "connectionsPublicAccess", icon: <GlobalOutlined />, label: labels.publicAccess },
          { key: "connectionsIntegrations", icon: <ApiOutlined />, label: labels.integrations }
        ]
      }
    ],
    [labels]
  );

  const navigate = (key: string) => {
    onNavigate(key as BrowserNavigationLeafKey);
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
        selectedKeys={[activeNavigationKey]}
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
