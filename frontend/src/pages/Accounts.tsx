import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { 
  Key, Trash2, AlertTriangle, Plus, X, Folder, Edit3, ChevronDown, ChevronRight, 
  Settings as SettingsIcon, List, FileText, CheckCircle2, RefreshCw, EyeOff, Globe, Move, Link as LinkIcon, ShieldAlert,
  BarChart3, Users, Search, Filter, User as UserIcon, Lock, Shield, Share2, ExternalLink, Send, Zap, WifiOff, Clock, RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GroupTokenManager from '../components/GroupTokenManager';
import EngagementCenter from '../components/EngagementCenter';
import FollowManagement from '../components/FollowManagement';

interface InstagramAccount {
  id: number;
  user_id: number;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  instagram_business_id: string | null;
  instagram_username: string;
  profile_picture: string | null;
  business_name: string | null;
  followers_count: number;
  token_expiry: string | null;
  status: string;
  group_id: number | null;
  group_name: string | null;
  owner_id: number | null;
  owner_name: string | null;
  linked_by: string | null;
  linked_at: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by?: number | null;
  deletion_reason?: string | null;
}

interface Group {
  id: number;
  user_id: number;
  name: string;
  account_count: number;
}

interface DiscoveredAccount {
  instagram_business_id: string;
  username: string;
  facebook_page_id: string;
  facebook_page_name: string;
  followers_count: number;
  profile_picture: string;
  business_name: string;
}

interface HistoryItem {
  id: number;
  account_id: number;
  instagram_username: string;
  media_url: string;
  caption: string;
  status: string;
  published_at: string;
  error_message: string | null;
}

export default function Accounts() {
  const location = useLocation();
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // OAuth callback result notification
  const [oauthMessage, setOauthMessage] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null);
  
  // RBAC User profile context
  const [userProfile, setUserProfile] = useState<{ id: number, role: string, username: string } | null>(null);
  const [transferOwnerAccId, setTransferOwnerAccId] = useState<number | null>(null);
  const [systemUsers, setSystemUsers] = useState<{ id: number, full_name: string, username: string }[]>([]);
  const [newOwnerId, setNewOwnerId] = useState<number | null>(null);
  
  // Shared Accounts Tab Management ("you" vs "others")
  const [topTab, setTopTab] = useState<'you' | 'others'>('you');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  
  // Accordion toggle state for Others tab tree view (Owner -> Group)
  const [expandedOwnerMap, setExpandedOwnerMap] = useState<Record<string, boolean>>({});
  const [expandedOthersGroupMap, setExpandedOthersGroupMap] = useState<Record<string, boolean>>({});
  
  // Basic Info sanitized modal state
  const [viewInfoAcc, setViewInfoAcc] = useState<InstagramAccount | null>(null);
  
  // Accordion status
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [activeTabMap, setActiveTabMap] = useState<Record<number, 'accounts' | 'token' | 'settings' | 'logs' | 'engagement' | 'follow'>>({});
  const [deleteId, setDeleteId] = useState<number | null>(null);
  
  // Group creation & renaming
  const [newGroupName, setNewGroupName] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [renameGroupId, setRenameGroupId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Move account manually
  const [movingAccId, setMovingAccId] = useState<number | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);

  // Group-level linking dialog states
  const [linkingGroupId, setLinkingGroupId] = useState<number | null>(null);
  const [linkToken, setLinkToken] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAccounts, setResolvedAccounts] = useState<DiscoveredAccount[]>([]);
  const [selectedDiscoveredAccs, setSelectedDiscoveredAccs] = useState<DiscoveredAccount[]>([]);
  
  // Conflict warning states
  const [conflictAccount, setConflictAccount] = useState<DiscoveredAccount | null>(null);
  const [conflictGroupName, setConflictGroupName] = useState('');
  const [linkingSubmitting, setLinkingSubmitting] = useState(false);
  const [linkMode, setLinkMode] = useState<'auto' | 'manual'>('auto');
  const [manualLinkUsername, setManualLinkUsername] = useState('');
  const [manualLinkPageId, setManualLinkPageId] = useState('');

  // Publishing logs history
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  // Edit credentials dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editAccessToken, setEditAccessToken] = useState('');
  const [editPageId, setEditPageId] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Per-account on-demand sync state
  const [syncingAccId, setSyncingAccId] = useState<number | null>(null);


  // -----------------------------------------------------------------------
  // TOKEN STATUS HELPER
  // Determines display status from DB token_expiry without calling Instagram API
  // -----------------------------------------------------------------------
  const getTokenStatusBadge = (acc: InstagramAccount) => {
    if (acc.status === 'Token Expired') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold">
          <WifiOff size={9} /> Token Expired
        </span>
      );
    }
    if (!acc.token_expiry) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600 text-slate-400 text-[10px] font-bold">
          <Clock size={9} /> No Expiry Set
        </span>
      );
    }
    const now = new Date();
    const expiry = new Date(acc.token_expiry);
    const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold">
          <WifiOff size={9} /> Token Expired
        </span>
      );
    }
    if (diffDays <= 7) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold">
          <AlertTriangle size={9} /> Expires in {diffDays}d
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-bold">
        <CheckCircle2 size={9} /> Active
      </span>
    );
  };

  // -----------------------------------------------------------------------
  // DATA FETCHING — Database is the single source of truth
  // fetchAccounts NEVER resets accounts to [] on failure — preserves existing data
  // -----------------------------------------------------------------------

  const fetchProfile = async () => {
    try {
      const response = await axios.get(`${API_URL}/profile`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setUserProfile(response.data);
    } catch (err) {
      console.error("[Accounts] Profile fetch error:", err);
    }
  };

  useEffect(() => {
    // Process OAuth callback query params BEFORE initial data load
    // This handles the redirect back from Facebook/Instagram OAuth
    const params = new URLSearchParams(location.search);
    const oauthStatus = params.get('status');
    const oauthUsername = params.get('username');
    const oauthMessage_ = params.get('message');
    
    if (oauthStatus === 'success' && oauthUsername) {
      const usernames = oauthUsername.split(',').join(', @');
      setOauthMessage({
        type: 'success',
        text: `✅ Successfully connected Instagram account(s): @${usernames}. Accounts have been saved to the database and will persist across sessions.`
      });
      // Clean the URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthStatus === 'error') {
      setOauthMessage({
        type: 'error',
        text: `❌ OAuth connection failed: ${oauthMessage_ || 'Unknown error. Please try again.'}`
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthStatus === 'warning') {
      setOauthMessage({
        type: 'warning',
        text: `⚠️ OAuth completed but: ${oauthMessage_ || 'No Instagram Business Accounts found on connected pages.'}`
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    fetchInitialData();
  }, []);

  /**
   * Loads all data independently so one failure doesn't wipe other data.
   * Accounts are ALWAYS loaded from the backend database — never from localStorage.
   * On page refresh, this re-fetches from the API and re-renders the UI.
   * On re-login, the same function is called again — accounts remain in DB.
   */
  const fetchInitialData = async () => {
    setLoading(true);
    
    // Run fetches independently — a failed groups fetch won't prevent accounts from loading
    const results = await Promise.allSettled([
      fetchProfile(),
      fetchGroups(),
      fetchAccounts(),
      fetchHistoryLogs()
    ]);
    
    // Report errors individually without clearing account data
    const errors: string[] = [];
    if (results[1].status === 'rejected') errors.push('Groups failed to load');
    if (results[2].status === 'rejected') errors.push('Accounts failed to load from database');
    
    if (errors.length > 0) {
      setError(`Some data failed to load: ${errors.join(', ')}. Existing data is preserved. Refresh to retry.`);
    } else {
      setError('');
    }
    
    setLoading(false);
  };

  const fetchGroups = async () => {
    const response = await axios.get(`${API_URL}/groups`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    });
    setGroups(response.data);
  };

  /**
   * CRITICAL: Fetches accounts from the backend database.
   * - Never resets accounts to [] on failure (preserves existing display)
   * - Logs the count for debugging
   * - Always uses authenticated API call — database is single source of truth
   */
  const fetchAccounts = async () => {
    try {
      const response = await axios.get(`${API_URL}/accounts`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const fetchedAccounts: InstagramAccount[] = response.data;
      console.log(`[Accounts] Fetched ${fetchedAccounts.length} account(s) from database.`);
      setAccounts(fetchedAccounts);
    } catch (err: any) {
      // CRITICAL: On fetch failure, preserve existing accounts — do NOT reset to []
      // This ensures a transient network error doesn't make all accounts disappear
      console.error('[Accounts] Failed to fetch accounts from API:', err?.response?.status, err?.message);
      throw err; // re-throw so fetchInitialData can track the error
    }
  };

  const fetchHistoryLogs = async () => {
    try {
      const response = await axios.get(`${API_URL}/publish/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setHistoryItems(response.data);
    } catch (e) {
      console.error('[Accounts] History log fetch failed:', e);
    }
  };

  /**
   * On-demand sync for a single Instagram account.
   * Calls POST /accounts/{id}/sync which refreshes profile data from Instagram API.
   * If token is expired, marks account as 'Token Expired' (never deletes it).
   */
  const handleSyncAccount = async (accId: number, username: string) => {
    setSyncingAccId(accId);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/accounts/${accId}/sync`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.data.status === 'synced') {
        setSuccessMsg(`@${username} synced: ${res.data.followers_count?.toLocaleString()} followers.`);
      } else {
        setSuccessMsg(`@${username}: ${res.data.message || 'Sync completed.'}`);
      }
      await fetchAccounts();
    } catch (err: any) {
      const detail = err.response?.data?.detail || `Sync failed for @${username}`;
      setError(detail);
      await fetchAccounts(); // Reload to show updated Token Expired status
    } finally {
      setSyncingAccId(null);
    }
  };

  const getGroupExpirySummary = (groupAccs: InstagramAccount[]) => {
    const activeAccs = groupAccs.filter(acc => acc.token_expiry);
    if (activeAccs.length === 0) return 'N/A';
    const expDates = activeAccs.map(acc => new Date(acc.token_expiry!));
    const earliest = new Date(Math.min(...expDates.map(d => d.getTime())));
    const diffTime = earliest.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formattedDate = earliest.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    if (diffDays <= 0) {
      return `${formattedDate} (Expired)`;
    }
    return `${formattedDate} (${diffDays} days left)`;
  };

  const getAccountExpirySummary = (expiry: string | null) => {
    if (!expiry) return 'N/A';
    const d = new Date(expiry);
    const diffTime = d.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formatted = d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    if (diffDays <= 0) {
      return `${formatted} (Expired)`;
    }
    return `${formatted} (${diffDays} days left)`;
  };




  const getOwnershipBadge = (acc: InstagramAccount) => {
    if (!userProfile) return null;
    const isAdmin = userProfile.role === "Super Admin" || userProfile.role === "Admin";
    const isOwner = acc.owner_id === userProfile.id;

    if (isAdmin) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold">
          👑 Admin
        </span>
      );
    } else if (isOwner) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold">
          ⭐ Owner
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-bold">
          👤 Shared
        </span>
      );
    }
  };

  const checkPermission = (acc: InstagramAccount) => {
    if (!userProfile) return false;
    if (userProfile.role === "Super Admin" || userProfile.role === "Admin") return true;
    if (acc.owner_id === userProfile.id) return true;
    return false;
  };

  const checkGroupTokenTabPermission = (group: Group) => {
    if (!userProfile) return false;
    if (userProfile.role === "Super Admin" || userProfile.role === "Admin") return true;
    // True if user owns at least one account in this group
    const groupAccounts = accounts.filter(acc => acc.group_id === group.id);
    return groupAccounts.some(acc => acc.owner_id === userProfile.id);
  };

  const checkGroupSettingsPermission = (group: Group) => {
    if (!userProfile) return false;
    if (userProfile.role === "Super Admin" || userProfile.role === "Admin") return true;
    if (group.user_id === userProfile.id) return true;
    return false;
  };

  // Unique Owners list for filter dropdowns
  const availableOwners = React.useMemo(() => {
    const map = new Map<number, string>();
    accounts.forEach(acc => {
      if (acc.owner_id && acc.owner_name) {
        map.set(acc.owner_id, acc.owner_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [accounts]);

  // Filtered accounts for YOU tab
  const youAccounts = React.useMemo(() => {
    return accounts.filter(acc => {
      const isMine = userProfile ? (acc.owner_id === userProfile.id || acc.user_id === userProfile.id) : true;
      if (!isMine) return false;

      const matchSearch = 
        acc.instagram_username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (acc.group_name && acc.group_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus = 
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? acc.status === 'Connected' :
        acc.status !== 'Connected';

      const matchGroup = groupFilter === 'all' ? true : acc.group_id === Number(groupFilter);

      return matchSearch && matchStatus && matchGroup;
    });
  }, [accounts, userProfile, searchQuery, statusFilter, groupFilter]);

  // Filtered accounts for OTHERS tab (grouped by Owner -> Group -> Accounts)
  const othersAccountsTree = React.useMemo(() => {
    const others = accounts.filter(acc => userProfile ? (acc.owner_id !== userProfile.id && acc.user_id !== userProfile.id) : false);

    const filtered = others.filter(acc => {
      const matchSearch = 
        acc.instagram_username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (acc.owner_name && acc.owner_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (acc.group_name && acc.group_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus = 
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? acc.status === 'Connected' :
        acc.status !== 'Connected';

      const matchGroup = groupFilter === 'all' ? true : acc.group_id === Number(groupFilter);
      const matchOwner = ownerFilter === 'all' ? true : acc.owner_id === Number(ownerFilter);

      return matchSearch && matchStatus && matchGroup && matchOwner;
    });

    const tree: Record<string, Record<string, InstagramAccount[]>> = {};
    filtered.forEach(acc => {
      const ownerName = acc.owner_name || `Owner #${acc.owner_id || acc.user_id}`;
      const groupName = acc.group_name || 'General Workspace';
      if (!tree[ownerName]) tree[ownerName] = {};
      if (!tree[ownerName][groupName]) tree[ownerName][groupName] = [];
      tree[ownerName][groupName].push(acc);
    });

    return tree;
  }, [accounts, userProfile, searchQuery, statusFilter, groupFilter, ownerFilter]);

  const toggleOwnerExpand = (ownerName: string) => {
    setExpandedOwnerMap(prev => ({ ...prev, [ownerName]: !prev[ownerName] }));
  };

  const toggleOthersGroupExpand = (key: string) => {
    setExpandedOthersGroupMap(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleOpenTransferOwner = async (accId: number) => {
    setTransferOwnerAccId(accId);
    try {
      const res = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSystemUsers(res.data);
      if (res.data.length > 0) {
        setNewOwnerId(res.data[0].id);
      }
    } catch (err) {
      console.error("Error loading users for transfer:", err);
    }
  };

  const handleTransferSubmit = async () => {
    if (!transferOwnerAccId || !newOwnerId) return;
    try {
      setError('');
      setSuccessMsg('');
      await axios.post(`${API_URL}/accounts/${transferOwnerAccId}/transfer-owner`, {
        new_owner_id: newOwnerId
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg("Ownership transferred successfully.");
      setTransferOwnerAccId(null);
      await fetchAccounts();
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError("Only the account owner or an administrator can modify this Instagram account.");
      } else {
        setError(err.response?.data?.detail || "Transfer ownership failed.");
      }
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    try {
      setError('');
      setSuccessMsg('');
      await axios.post(`${API_URL}/groups`, { name: newGroupName.trim() }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setNewGroupName('');
      setShowCreateGroup(false);
      setSuccessMsg("Group created successfully.");
      await fetchGroups();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create group.");
    }
  };

  const handleRenameGroup = async (groupId: number) => {
    if (!renameValue.trim()) return;
    try {
      setError('');
      setSuccessMsg('');
      await axios.put(`${API_URL}/groups/${groupId}`, { name: renameValue.trim() }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setRenameGroupId(null);
      setRenameValue('');
      setSuccessMsg("Group renamed successfully.");
      await fetchGroups();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to rename group.");
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      setError('');
      setSuccessMsg('');
      await axios.delete(`${API_URL}/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg("Group deleted successfully.");
      setExpandedGroupId(null);
      await fetchGroups();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete group.");
    }
  };

  const handleMoveAccount = async (accountId: number, targetGroupId: number) => {
    try {
      setError('');
      setSuccessMsg('');
      await axios.post(`${API_URL}/accounts/${accountId}/move`, { group_id: targetGroupId }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg("Profile moved successfully.");
      setMovingAccId(null);
      await Promise.all([fetchGroups(), fetchAccounts()]);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to move account.");
    }
  };

  // Group linking dialog triggers
  const handleOpenLinkDialog = (gId: number) => {
    setLinkingGroupId(gId);
    setLinkToken('');
    setResolvedAccounts([]);
    setSelectedDiscoveredAccs([]);
    setConflictAccount(null);
    setConflictGroupName('');
    setLinkingSubmitting(false);
    setLinkMode('auto');
    setManualLinkUsername('');
    setManualLinkPageId('');
  };

  const handleResolveConnectedAccounts = async () => {
    if (!linkToken.trim()) return;
    setIsResolving(true);
    setResolvedAccounts([]);
    setSelectedDiscoveredAccs([]);
    try {
      const res = await axios.post(`${API_URL}/groups/resolve-accounts`, {
        access_token: linkToken.trim()
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setResolvedAccounts(res.data);
      setSelectedDiscoveredAccs(res.data); // select all by default
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to resolve profiles. Verify token access rights.");
    } finally {
      setIsResolving(false);
    }
  };

  const handleManualLinkSubmit = async (e: React.FormEvent, force: boolean = false) => {
    e.preventDefault();
    if (!manualLinkUsername.trim() || !manualLinkPageId.trim() || !linkToken.trim() || !linkingGroupId) {
      setError("Please fill in all required fields.");
      return;
    }
    setLinkingSubmitting(true);
    setError('');
    try {
      await axios.post(`${API_URL}/groups/${linkingGroupId}/link-instagram`, {
        instagram_username: manualLinkUsername.trim(),
        facebook_page_id: manualLinkPageId.trim(),
        facebook_page_name: manualLinkUsername.trim() + " Page",
        access_token: linkToken.trim(),
        force_move: force
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setLinkingGroupId(null);
      setManualLinkUsername('');
      setManualLinkPageId('');
      setLinkToken('');
      await Promise.all([fetchGroups(), fetchAccounts()]);
    } catch (err: any) {
      if (err.response?.status === 409) {
        const detail = err.response.data.detail;
        setConflictAccount({
          instagram_business_id: '',
          username: manualLinkUsername.trim(),
          facebook_page_id: manualLinkPageId.trim(),
          facebook_page_name: manualLinkUsername.trim() + " Page",
          followers_count: 0,
          profile_picture: "https://placekitten.com/200/200",
          business_name: manualLinkUsername.trim() + " Page"
        });
        setConflictGroupName(detail.group_name);
      } else {
        setError(err.response?.data?.detail || "Manual connection failed. Verify token permissions and parameters.");
      }
    } finally {
      setLinkingSubmitting(false);
    }
  };

  const handleToggleSelectDiscovered = (acc: DiscoveredAccount) => {
    if (selectedDiscoveredAccs.some(x => x.instagram_business_id === acc.instagram_business_id)) {
      setSelectedDiscoveredAccs(selectedDiscoveredAccs.filter(x => x.instagram_business_id !== acc.instagram_business_id));
    } else {
      setSelectedDiscoveredAccs([...selectedDiscoveredAccs, acc]);
    }
  };

  const handleSelectAllDiscovered = () => {
    setSelectedDiscoveredAccs(resolvedAccounts);
  };

  const handleClearDiscovered = () => {
    setSelectedDiscoveredAccs([]);
  };

  const handleAddAccountsWorkflow = async () => {
    if (selectedDiscoveredAccs.length === 0 || !linkingGroupId) return;
    setLinkingSubmitting(true);
    setError('');
    
    // Process queue sequentially to handle conflict responses individually
    const accountsToProcess = [...selectedDiscoveredAccs];
    setSelectedDiscoveredAccs([]); // clear out queue

    await processLinkQueue(accountsToProcess, false);
  };

  const processLinkQueue = async (queue: DiscoveredAccount[], force: boolean) => {
    if (queue.length === 0 || !linkingGroupId) {
      setLinkingSubmitting(false);
      setLinkingGroupId(null);
      await Promise.all([fetchGroups(), fetchAccounts()]);
      return;
    }

    const currentAcc = queue[0];
    const remaining = queue.slice(1);

    try {
      await axios.post(`${API_URL}/groups/${linkingGroupId}/link-instagram`, {
        instagram_username: currentAcc.username,
        facebook_page_id: currentAcc.facebook_page_id,
        facebook_page_name: currentAcc.facebook_page_name,
        instagram_business_id: currentAcc.instagram_business_id,
        access_token: linkToken.trim(),
        followers_count: currentAcc.followers_count,
        profile_picture: currentAcc.profile_picture,
        force_move: force
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      
      // Proceed to next account
      await processLinkQueue(remaining, false);
    } catch (err: any) {
      if (err.response?.status === 409) {
        // Exists in other group conflict
        const detail = err.response.data.detail;
        setConflictAccount(currentAcc);
        setConflictGroupName(detail.group_name);
        // Pause queue processing and wait for conflict resolution dialog choice
        setSelectedDiscoveredAccs(remaining);
      } else {
        setError(err.response?.data?.detail || `Failed to link account @${currentAcc.username}`);
        setLinkingSubmitting(false);
      }
    }
  };

  const handleResolveConflictChoice = async (choice: 'move' | 'keep' | 'cancel') => {
    if (!conflictAccount || !linkingGroupId) return;

    const remaining = selectedDiscoveredAccs;
    const acc = conflictAccount;
    
    setConflictAccount(null);
    setConflictGroupName('');

    if (choice === 'move') {
      setLinkingSubmitting(true);
      try {
        await axios.post(`${API_URL}/groups/${linkingGroupId}/link-instagram`, {
          instagram_username: acc.username,
          facebook_page_id: acc.facebook_page_id,
          facebook_page_name: acc.facebook_page_name,
          instagram_business_id: acc.instagram_business_id || null,
          access_token: linkToken.trim(),
          followers_count: acc.followers_count,
          profile_picture: acc.profile_picture,
          force_move: true
        }, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        });
        
        if (!acc.instagram_business_id) {
          setLinkingGroupId(null);
          setManualLinkUsername('');
          setManualLinkPageId('');
          setLinkToken('');
          setLinkingSubmitting(false);
          await Promise.all([fetchGroups(), fetchAccounts()]);
          return;
        }

        await processLinkQueue(remaining, false);
      } catch (err: any) {
        setError(err.response?.data?.detail || `Failed to move account @${acc.username}`);
        setLinkingSubmitting(false);
      }
    } else if (choice === 'keep') {
      if (!acc.instagram_business_id) {
        setLinkingGroupId(null);
        setManualLinkUsername('');
        setManualLinkPageId('');
        setLinkToken('');
        return;
      }
      setLinkingSubmitting(true);
      await processLinkQueue(remaining, false);
    } else {
      setLinkingSubmitting(false);
      setLinkingGroupId(null);
      await Promise.all([fetchGroups(), fetchAccounts()]);
    }
  };

  const handleOpenEditDialog = (acc: InstagramAccount) => {
    setEditAccountId(acc.id);
    setEditUsername(acc.instagram_username);
    setEditAccessToken('');
    setEditPageId(acc.facebook_page_id || '');
    setEditDialogOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccountId) return;

    setEditSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      await axios.put(`${API_URL}/accounts/${editAccountId}`, {
        access_token: editAccessToken.trim() || null,
        facebook_page_id: editPageId.trim() || null
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      setSuccessMsg(`Successfully updated credentials for @${editUsername}`);
      setEditDialogOpen(false);
      await fetchAccounts();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update account credentials.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`${API_URL}/accounts/${deleteId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg("Account successfully disconnected and soft-deleted. All publishing records preserved.");
      await Promise.all([fetchGroups(), fetchAccounts()]);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError("Only the account owner or an administrator can modify or disconnect this Instagram account.");
      } else {
        setError(err.response?.data?.detail || "Failed to disconnect account.");
      }
    } finally {
      setDeleteId(null);
    }
  };

  const handleRestoreAccount = async (accountId: number) => {
    try {
      setError('');
      setSuccessMsg('');
      await axios.post(`${API_URL}/accounts/${accountId}/restore`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg("Instagram profile successfully restored!");
      await Promise.all([fetchGroups(), fetchAccounts()]);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError("Only the account owner or an administrator can restore this Instagram account.");
      } else {
        setError(err.response?.data?.detail || "Failed to restore Instagram account.");
      }
    }
  };

  const toggleGroupExpand = (groupId: number) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
    } else {
      setExpandedGroupId(groupId);
      if (!activeTabMap[groupId]) {
        setActiveTabMap(prev => ({ ...prev, [groupId]: 'accounts' }));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* OAuth Callback Result Banner — shown when returning from Facebook OAuth */}
      <AnimatePresence>
        {oauthMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`p-4 rounded-2xl border flex items-start gap-3 ${
              oauthMessage.type === 'success' 
                ? 'bg-green-500/10 border-green-500/20 text-green-300'
                : oauthMessage.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}
          >
            <div className="flex-1 text-sm font-semibold">{oauthMessage.text}</div>
            <button onClick={() => setOauthMessage(null)} className="text-slate-400 hover:text-slate-200 cursor-pointer shrink-0">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black font-outfit text-slate-100 mb-1.5 flex items-center gap-2">
            <Folder className="text-purple-400" />
            <span>Instagram Accounts Hub</span>
          </h1>
          <p className="text-sm text-slate-400">Manage your linked profiles or collaborate across shared team Instagram accounts.</p>
        </div>

        <div className="flex gap-2">
          {/* Create Group Button */}
          <button
            onClick={() => setShowCreateGroup(!showCreateGroup)}
            className="px-4 py-2 gradient-btn text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all hover:shadow-purple-500/10"
          >
            <Plus size={14} />
            <span>New Group</span>
          </button>

          {/* Global Follow Management Button */}
          <button
            onClick={() => setShowFollowModal(true)}
            className="px-4 py-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
          >
            <Users size={14} />
            <span>Follow Management</span>
          </button>
        </div>
      </div>

      {/* Show Create Group Dialog Inline */}
      <AnimatePresence>
        {showCreateGroup && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel p-4 rounded-xl border border-slate-900 max-w-md"
          >
            <form onSubmit={handleCreateGroup} className="flex gap-2">
              <input
                type="text"
                required
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. Political News"
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 gradient-btn text-slate-950 font-bold rounded-xl text-xs cursor-pointer"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreateGroup(false)}
                className="px-3 py-2 border border-slate-800 hover:bg-slate-900 text-slate-400 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Level Tab Switcher: YOU vs OTHERS */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex bg-slate-900/60 p-1.5 rounded-2xl border border-slate-850 gap-2 w-full sm:w-auto">
          <button
            onClick={() => setTopTab('you')}
            className={`flex-1 sm:flex-initial py-2.5 px-6 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
              topTab === 'you'
                ? "bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            <UserIcon size={14} />
            <span>You</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-slate-950/40 font-mono">
              {youAccounts.length}
            </span>
          </button>

          <button
            onClick={() => setTopTab('others')}
            className={`flex-1 sm:flex-initial py-2.5 px-6 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
              topTab === 'others'
                ? "bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            <Share2 size={14} />
            <span>Others</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-slate-950/40 font-mono">
              {accounts.filter(acc => acc.owner_id !== userProfile?.id && acc.user_id !== userProfile?.id).length}
            </span>
          </button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-900 flex flex-col md:flex-row gap-3 items-center justify-between shadow-md">
        {/* Search Input */}
        <div className="relative flex-1 w-full">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text"
            placeholder="Search by username, owner, or group..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 focus:border-purple-500/50 rounded-xl outline-none text-xs text-slate-200 transition-all"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto text-xs">
          <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-1.5">
            <Filter size={12} className="text-slate-500" />
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="bg-transparent outline-none text-slate-300 font-semibold cursor-pointer text-xs"
            >
              <option value="all">All Status</option>
              <option value="active">Active Connected</option>
              <option value="inactive">Action Required</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-1.5">
            <Folder size={12} className="text-slate-500" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="bg-transparent outline-none text-slate-300 font-semibold cursor-pointer text-xs"
            >
              <option value="all">All Groups</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {topTab === 'others' && (
            <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-1.5">
              <UserIcon size={12} className="text-slate-500" />
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="bg-transparent outline-none text-slate-300 font-semibold cursor-pointer text-xs"
              >
                <option value="all">All Owners</option>
                {availableOwners.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Content View Switcher */}
      {topTab === 'you' ? (
        /* TAB 1: YOU - Groups Layout */
        <div className="space-y-5">
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw size={24} className="animate-spin text-purple-500 mx-auto" />
            </div>
          ) : groups.length === 0 ? (
            <div className="glass-panel p-12 text-center rounded-2xl border border-slate-900">
              <h3 className="text-lg font-bold text-slate-300 mb-1">No Workspace Groups</h3>
              <p className="text-sm text-slate-500">Create a group using the New Group button to begin linking Instagram feeds.</p>
            </div>
          ) : (
            groups.map((group) => {
              const groupAccounts = youAccounts.filter(acc => acc.group_id === group.id);
              const isExpanded = expandedGroupId === group.id;
              const activeTab = activeTabMap[group.id] || 'accounts';
              const groupHasExpired = groupAccounts.some(acc => acc.status !== 'Connected');

              return (
                <div key={group.id} className="glass-panel rounded-2xl border border-slate-900 overflow-hidden transition-all duration-300 shadow-lg">
                  {/* Header accordion bar */}
                  <div 
                    onClick={() => toggleGroupExpand(group.id)}
                    className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-900/25 transition-colors select-none bg-slate-950/20"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={18} className="text-purple-400" /> : <ChevronRight size={18} className="text-slate-500" />}
                      {renameGroupId === group.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-200 outline-none"
                          />
                          <button
                            onClick={() => handleRenameGroup(group.id)}
                            className="p-1 text-green-400 hover:text-green-300 cursor-pointer"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                          <button
                            onClick={() => setRenameGroupId(null)}
                            className="p-1 text-red-400 hover:text-red-300 cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div>
                          <h2 className="text-md font-bold font-outfit text-slate-200 flex items-center gap-2">
                            <span>{group.name}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 font-bold font-mono">
                              {groupAccounts.length} Connected
                            </span>
                          </h2>
                        </div>
                      )}
                    </div>

                    {/* Group Statistics in Accordion Header */}
                    <div className="flex flex-wrap items-center gap-4 text-xs font-semibold" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Token Status:</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          groupAccounts.length === 0 
                            ? "bg-slate-900 text-slate-500 border border-slate-800" 
                            : groupHasExpired 
                              ? "bg-red-500/10 text-red-400 border border-red-500/20" 
                              : "bg-green-500/10 text-green-400 border border-green-500/20"
                        }`}>
                          {groupAccounts.length === 0 ? "Empty" : groupHasExpired ? "Action Required" : "Connected"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Group Expiry:</span>
                        <span className="text-purple-400 font-mono text-[10px] bg-purple-500/5 px-2 py-0.5 border border-purple-500/10 rounded">
                          {getGroupExpirySummary(groupAccounts)}
                        </span>
                      </div>

                      {checkGroupSettingsPermission(group) && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setRenameGroupId(group.id); setRenameValue(group.name); }}
                            className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                            title="Rename Group"
                          >
                            <Edit3 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Group Panels */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="border-t border-slate-900 bg-slate-950/40 overflow-hidden"
                      >
                        {/* Sub-Header Area */}
                        <div className="p-5 border-b border-slate-900/60 bg-purple-500/[0.01] flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-400">Workspace Integration Panel</span>
                          {checkGroupSettingsPermission(group) && (
                            <button
                              onClick={() => handleOpenLinkDialog(group.id)}
                              className="px-4 py-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 hover:text-purple-300 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                            >
                              <LinkIcon size={12} />
                              <span>Link Instagram Profile</span>
                            </button>
                          )}
                        </div>

                        {/* Tab Selectors */}
                        <div className="flex border-b border-slate-900 px-4 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-950/20">
                          <button
                            onClick={() => setActiveTabMap(prev => ({ ...prev, [group.id]: 'accounts' }))}
                            className={`px-4 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                              activeTab === 'accounts' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
                            }`}
                          >
                            <List size={12} />
                            <span>Accounts</span>
                          </button>
                          {checkGroupTokenTabPermission(group) && (
                            <button
                              onClick={() => setActiveTabMap(prev => ({ ...prev, [group.id]: 'token' }))}
                              className={`px-4 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === 'token' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
                              }`}
                            >
                              <Key size={12} />
                              <span>Access Token</span>
                            </button>
                          )}
                          {checkGroupSettingsPermission(group) && (
                            <button
                              onClick={() => setActiveTabMap(prev => ({ ...prev, [group.id]: 'settings' }))}
                              className={`px-4 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === 'settings' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
                              }`}
                            >
                              <SettingsIcon size={12} />
                              <span>Settings</span>
                            </button>
                          )}
                          <button
                            onClick={() => setActiveTabMap(prev => ({ ...prev, [group.id]: 'logs' }))}
                            className={`px-4 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                              activeTab === 'logs' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
                            }`}
                          >
                            <FileText size={12} />
                            <span>Publishing Logs</span>
                          </button>
                          <button
                            onClick={() => setActiveTabMap(prev => ({ ...prev, [group.id]: 'engagement' }))}
                            className={`px-4 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                              activeTab === 'engagement' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
                            }`}
                          >
                            <BarChart3 size={12} />
                            <span>Engagement Center</span>
                          </button>
                        </div>

                        {/* Tab Content Display */}
                        <div className="p-5">
                          {activeTab === 'accounts' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {groupAccounts.length === 0 ? (
                                <div className="col-span-full py-8 text-center text-xs text-slate-500">
                                  No connected accounts in this group. Click 'Link Instagram Profile' above to add accounts to this workspace.
                                </div>
                              ) : (
                                groupAccounts.map(acc => (
                                  <div key={acc.id} className="p-4 rounded-xl border border-slate-900 bg-slate-900/35 flex flex-col justify-between gap-3 shadow-md">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <img src={acc.profile_picture || "https://placekitten.com/200/200"} className="w-10 h-10 rounded-full object-cover border border-purple-500/25" alt="Profile" />
                                        <div>
                                          <h4 className="text-sm font-bold text-slate-200 leading-tight flex items-center gap-2">
                                            <span>@{acc.instagram_username}</span>
                                            {getOwnershipBadge(acc)}
                                          </h4>
                                          <span className="text-[10px] text-slate-500">{acc.business_name || 'Instagram Profile'}</span>
                                        </div>
                                      </div>
                                      
                                      {checkPermission(acc) && (
                                        <div className="flex gap-1.5">
                                          {/* Sync Now — refreshes profile data from Instagram API on-demand */}
                                          <button
                                            onClick={() => handleSyncAccount(acc.id, acc.instagram_username)}
                                            disabled={syncingAccId === acc.id}
                                            className="p-1.5 hover:bg-slate-900 text-cyan-400 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                                            title="Sync profile data from Instagram (refreshes follower count, checks token)"
                                          >
                                            {syncingAccId === acc.id 
                                              ? <RefreshCw size={12} className="animate-spin" />
                                              : <RefreshCw size={12} />}
                                          </button>
                                          <button
                                            onClick={() => handleOpenEditDialog(acc)}
                                            className="p-1.5 hover:bg-slate-900 text-purple-400 rounded-md transition-colors cursor-pointer"
                                            title="Edit Credentials"
                                          >
                                            <Key size={12} />
                                          </button>
                                          <button
                                            onClick={() => setDeleteId(acc.id)}
                                            className="p-1.5 hover:bg-slate-900 text-red-400 rounded-md transition-colors cursor-pointer"
                                            title="Disconnect profile"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    {/* Info details */}
                                    <div className="text-[11px] space-y-1 pt-2 border-t border-slate-900">
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-500">Owner Name:</span>
                                        <span className="text-slate-300 font-semibold flex items-center gap-1">
                                          <span>{acc.owner_name || 'N/A'}</span>
                                          {(userProfile?.role === "Super Admin" || userProfile?.role === "Admin") && (
                                            <button
                                              onClick={() => handleOpenTransferOwner(acc.id)}
                                              className="p-0.5 hover:bg-slate-800 text-purple-400 rounded"
                                              title="Transfer Ownership"
                                            >
                                              <Edit3 size={10} />
                                            </button>
                                          )}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Linked By:</span>
                                        <span className="text-slate-300 font-semibold">{acc.linked_by || 'N/A'}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Linked Date:</span>
                                        <span className="text-slate-400 font-mono text-[10px]">
                                          {acc.linked_at ? new Date(acc.linked_at).toLocaleDateString() : 'N/A'}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Facebook Page:</span>
                                        <span className="text-slate-400 font-mono">{acc.facebook_page_name || 'N/A'}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Followers:</span>
                                        <span className="text-purple-400 font-bold font-mono">{acc.followers_count.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Token Expiry:</span>
                                        <span className="text-purple-400 font-mono text-[10px]">
                                          {getAccountExpirySummary(acc.token_expiry)}
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-500">Status:</span>
                                        <div className="flex items-center gap-1.5">
                                          {getTokenStatusBadge(acc)}
                                          {acc.status === 'Token Expired' && (
                                            <button
                                              onClick={() => handleOpenEditDialog(acc)}
                                              className="text-[9px] text-amber-400 hover:text-amber-300 underline cursor-pointer"
                                              title="Update token to reconnect"
                                            >
                                              Reconnect
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Move options selector */}
                                    {checkPermission(acc) && (
                                      <div className="pt-2 border-t border-slate-900 flex items-center justify-between">
                                        <span className="text-[10px] text-slate-500 font-semibold uppercase flex items-center gap-1">
                                          <Move size={10} />
                                          <span>Move to group</span>
                                        </span>
                                        <select
                                          value={acc.group_id || ''}
                                          onChange={(e) => handleMoveAccount(acc.id, Number(e.target.value))}
                                          className="text-[10px] bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 outline-none text-slate-300 font-bold"
                                        >
                                          {groups.map(g => (
                                            <option key={g.id} value={g.id}>{g.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {activeTab === 'token' && (
                            <GroupTokenManager 
                              groupId={group.id} 
                              accounts={groupAccounts} 
                              onRefresh={fetchAccounts} 
                            />
                          )}

                          {activeTab === 'settings' && (
                            <div className="space-y-6 max-w-md">
                              <div className="space-y-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Rename Group</label>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    defaultValue={group.name}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    placeholder="Enter new group name..."
                                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 outline-none focus:border-purple-500/50"
                                  />
                                  <button
                                    onClick={() => handleRenameGroup(group.id)}
                                    className="px-4 py-2 gradient-btn text-slate-950 font-bold rounded-xl text-xs cursor-pointer"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>

                              <div className="pt-4 border-t border-slate-900 space-y-2">
                                <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider">Danger Zone</h4>
                                <p className="text-[11px] text-slate-500">Only empty groups (0 connected accounts) can be deleted. Please move all profiles to another group before attempting to delete.</p>
                                <button
                                  type="button"
                                  disabled={groupAccounts.length > 0}
                                  onClick={() => handleDeleteGroup(group.id)}
                                  className="px-4 py-2 bg-red-950 hover:bg-red-900 border border-red-800 text-red-400 hover:text-red-300 font-bold rounded-xl text-xs transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Delete Group
                                </button>
                              </div>
                            </div>
                          )}

                          {activeTab === 'logs' && (
                            <div className="space-y-3">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Publishing Logs (Recent)</h4>
                              {historyItems.filter(h => groupAccounts.some(acc => acc.instagram_username.toLowerCase() === h.instagram_username.toLowerCase())).length === 0 ? (
                                <div className="py-8 text-center text-xs text-slate-600">No recent logs recorded for this group's accounts.</div>
                              ) : (
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                  {historyItems
                                    .filter(h => groupAccounts.some(acc => acc.instagram_username.toLowerCase() === h.instagram_username.toLowerCase()))
                                    .map(log => (
                                      <div key={log.id} className="p-3 bg-slate-900/30 border border-slate-900 rounded-lg flex justify-between items-start gap-4">
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-bold text-slate-300">@{log.instagram_username}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                              log.status === 'success' || log.status === 'Completed' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                            }`}>
                                              {log.status}
                                            </span>
                                          </div>
                                          <p className="text-[10px] text-slate-500 line-clamp-1">{log.caption}</p>
                                          {log.error_message && <p className="text-[9px] text-red-400 font-mono">{log.error_message}</p>}
                                        </div>
                                        <span className="text-[9px] text-slate-500 font-mono shrink-0">
                                          {new Date(log.published_at).toLocaleString()}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}

                          {activeTab === 'engagement' && (
                            <EngagementCenter
                              groupId={group.id}
                              accounts={groupAccounts}
                            />
                          )}

                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* TAB 2: OTHERS - Hierarchical Expandable Tree View (Owner -> Group -> Accounts) */
        <div className="space-y-4">
          {Object.keys(othersAccountsTree).length === 0 ? (
            <div className="glass-panel p-12 text-center rounded-2xl border border-slate-900">
              <Share2 size={24} className="text-slate-600 mx-auto mb-2" />
              <h3 className="text-lg font-bold text-slate-300 mb-1">No Shared Accounts Found</h3>
              <p className="text-sm text-slate-500">Other team members haven't shared Instagram accounts yet or match your current filter query.</p>
            </div>
          ) : (
            Object.entries(othersAccountsTree).map(([ownerName, groupsMap]) => {
              const isOwnerExpanded = expandedOwnerMap[ownerName] !== false; // Default expanded
              const totalOwnerAccounts = Object.values(groupsMap).reduce((acc, list) => acc + list.length, 0);

              return (
                <div key={ownerName} className="glass-panel rounded-2xl border border-slate-900 overflow-hidden shadow-lg space-y-1">
                  {/* Owner Level Accordion Header */}
                  <div 
                    onClick={() => toggleOwnerExpand(ownerName)}
                    className="p-4 flex items-center justify-between bg-slate-950/40 hover:bg-slate-900/30 cursor-pointer select-none border-b border-slate-900"
                  >
                    <div className="flex items-center gap-3">
                      {isOwnerExpanded ? <ChevronDown size={18} className="text-purple-400" /> : <ChevronRight size={18} className="text-slate-500" />}
                      <div className="w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-xs">
                        {ownerName.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                          <span>{ownerName}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-purple-400 font-mono font-bold">
                            {totalOwnerAccounts} Shared Accounts
                          </span>
                        </h2>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Lock size={12} className="text-amber-500" />
                      <span className="text-[11px] text-amber-500/80 font-medium">Read & Publish Only</span>
                    </div>
                  </div>

                  {/* Expanded Groups under Owner */}
                  {isOwnerExpanded && (
                    <div className="p-4 space-y-4 bg-slate-950/20">
                      {Object.entries(groupsMap).map(([groupName, groupAccs]) => {
                        const groupKey = `${ownerName}_${groupName}`;
                        const isGroupExpanded = expandedOthersGroupMap[groupKey] !== false; // Default expanded

                        return (
                          <div key={groupName} className="border border-slate-900/80 bg-slate-900/20 rounded-xl overflow-hidden">
                            {/* Group Accordion Header */}
                            <div 
                              onClick={() => toggleOthersGroupExpand(groupKey)}
                              className="p-3 bg-slate-900/40 hover:bg-slate-900/60 cursor-pointer select-none flex items-center justify-between border-b border-slate-900/60"
                            >
                              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                                {isGroupExpanded ? <ChevronDown size={14} className="text-purple-400" /> : <ChevronRight size={14} className="text-slate-500" />}
                                <Folder size={14} className="text-purple-400" />
                                <span>{groupName}</span>
                                <span className="text-[10px] text-slate-500 font-mono font-normal">({groupAccs.length} profiles)</span>
                              </div>

                              <span className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded font-bold">
                                Publish Available
                              </span>
                            </div>

                            {/* Accounts List Grid */}
                            {isGroupExpanded && (
                              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {groupAccs.map(acc => (
                                  <div key={acc.id} className="p-4 rounded-xl border border-slate-900 bg-slate-900/35 flex flex-col justify-between gap-3 shadow-md">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <img src={acc.profile_picture || "https://placekitten.com/200/200"} className="w-10 h-10 rounded-full object-cover border border-purple-500/25" alt="Profile" />
                                        <div>
                                          <h4 className="text-sm font-bold text-slate-200 leading-tight">@{acc.instagram_username}</h4>
                                          <span className="text-[10px] text-slate-500">{acc.business_name || 'Instagram Profile'}</span>
                                        </div>
                                      </div>
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-bold">
                                        👤 Shared
                                      </span>
                                    </div>

                                    {/* Sanitized Details Only */}
                                    <div className="text-[11px] space-y-1 pt-2 border-t border-slate-900">
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Account Owner:</span>
                                        <span className="text-slate-300 font-semibold">{acc.owner_name || ownerName}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Group Name:</span>
                                        <span className="text-purple-400 font-semibold">{acc.group_name || groupName}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Account Status:</span>
                                        <span className={`px-1.5 rounded text-[9px] font-bold ${
                                          acc.status === 'Connected' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                        }`}>
                                          {acc.status === 'Connected' ? 'Active' : 'Inactive'}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Publish Availability:</span>
                                        <span className="text-green-400 font-mono text-[10px] font-bold">
                                          Ready for Campaigns
                                        </span>
                                      </div>
                                    </div>

                                    {/* Action Buttons for Shared Accounts */}
                                    <div className="pt-2 border-t border-slate-900 flex items-center justify-end gap-2">
                                      <button
                                        onClick={() => setViewInfoAcc(acc)}
                                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                      >
                                        <EyeOff size={12} />
                                        <span>Basic Info</span>
                                      </button>
                                      <a
                                        href="/"
                                        className="px-3 py-1 bg-purple-500 hover:bg-purple-400 text-slate-950 rounded-lg text-xs font-black flex items-center gap-1 transition-all cursor-pointer shadow-md"
                                      >
                                        <Send size={12} />
                                        <span>Publish</span>
                                      </a>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* --- Group Link Instagram Dialog Modal --- */}
      <AnimatePresence>
        {linkingGroupId !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (!linkingSubmitting) setLinkingGroupId(null); }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-xl rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900 flex justify-between items-center bg-slate-950/40">
                <h3 className="text-xl font-bold font-outfit text-slate-100 flex items-center gap-2">
                  <LinkIcon className="text-purple-400" size={18} />
                  <span>Link Profiles: {groups.find(g => g.id === linkingGroupId)?.name}</span>
                </h3>
                <button
                  disabled={linkingSubmitting}
                  onClick={() => setLinkingGroupId(null)}
                  className="text-slate-500 hover:text-slate-300 disabled:opacity-30 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                
                {/* Step 1: Input token to resolve accounts */}
                {resolvedAccounts.length === 0 ? (
                  <div className="space-y-4">
                    
                    {/* Link Mode Selector Toggles */}
                    <div className="flex border border-slate-900 mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-950/40 rounded-xl overflow-hidden p-1 gap-1">
                      <button
                        type="button"
                        onClick={() => setLinkMode('auto')}
                        className={`flex-1 py-2 text-center rounded-lg transition-all cursor-pointer ${
                          linkMode === 'auto' ? 'bg-purple-600 text-white font-extrabold' : 'hover:text-slate-300'
                        }`}
                      >
                        Auto Discover (Token)
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkMode('manual')}
                        className={`flex-1 py-2 text-center rounded-lg transition-all cursor-pointer ${
                          linkMode === 'manual' ? 'bg-purple-600 text-white font-extrabold' : 'hover:text-slate-300'
                        }`}
                      >
                        Manual Connect
                      </button>
                    </div>

                    {linkMode === 'auto' ? (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-400">Paste your Meta Access Token to discover connected Instagram Business Accounts.</p>
                        
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Page Access Token</label>
                          <textarea
                            rows={3}
                            required
                            value={linkToken}
                            onChange={(e) => setLinkToken(e.target.value)}
                            placeholder="Starts with EAA..."
                            className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs font-mono transition-all placeholder:text-slate-700"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleResolveConnectedAccounts}
                          disabled={isResolving || !linkToken}
                          className="w-full py-3 gradient-btn text-slate-950 font-extrabold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isResolving ? <RefreshCw size={14} className="animate-spin text-slate-950" /> : <RefreshCw size={14} />}
                          <span>Resolve Connected Profiles</span>
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={(e) => handleManualLinkSubmit(e, false)} className="space-y-4">
                        <p className="text-xs text-slate-400">Explicitly link a profile by entering its parameters below.</p>
                        
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Instagram Username *</label>
                          <input
                            type="text"
                            required
                            value={manualLinkUsername}
                            onChange={(e) => setManualLinkUsername(e.target.value)}
                            placeholder="e.g. mock_instagram_user"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs transition-all placeholder:text-slate-700"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Facebook Page ID *</label>
                          <input
                            type="text"
                            required
                            value={manualLinkPageId}
                            onChange={(e) => setManualLinkPageId(e.target.value)}
                            placeholder="e.g. 10485769213"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs transition-all placeholder:text-slate-700"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Page Access Token *</label>
                          <textarea
                            rows={2}
                            required
                            value={linkToken}
                            onChange={(e) => setLinkToken(e.target.value)}
                            placeholder="Starts with EAA..."
                            className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs font-mono transition-all placeholder:text-slate-700"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={linkingSubmitting || !manualLinkUsername || !manualLinkPageId || !linkToken}
                          className="w-full py-3 gradient-btn text-slate-950 font-extrabold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {linkingSubmitting ? <RefreshCw size={14} className="animate-spin text-slate-950" /> : <LinkIcon size={14} />}
                          <span>Link Profile Manual</span>
                        </button>
                      </form>
                    )}

                  </div>
                ) : (
                  
                  // Step 2: Discovered accounts selection grid
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">Discovered Profiles</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllDiscovered}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={handleClearDiscovered}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          Clear Selection
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-900 rounded-xl overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-900/40 border-b border-slate-900 text-slate-400 uppercase text-[10px] font-bold">
                            <th className="p-3 w-12 text-center">Select</th>
                            <th className="p-3">Instagram Account</th>
                            <th className="p-3">Facebook Page</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resolvedAccounts.map(acc => {
                            const isChecked = selectedDiscoveredAccs.some(x => x.instagram_business_id === acc.instagram_business_id);
                            return (
                              <tr key={acc.instagram_business_id} className="border-b border-slate-900 text-slate-300">
                                <td className="p-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleSelectDiscovered(acc)}
                                    className="accent-purple-500 cursor-pointer"
                                  />
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <img src={acc.profile_picture} className="w-6 h-6 rounded-full object-cover" alt="Profile" />
                                    <span className="font-bold">@{acc.username}</span>
                                  </div>
                                </td>
                                <td className="p-3 text-slate-500 font-medium">{acc.facebook_page_name}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={handleAddAccountsWorkflow}
                        disabled={linkingSubmitting || selectedDiscoveredAccs.length === 0}
                        className="flex-1 py-3 gradient-btn text-slate-950 font-black rounded-xl cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {linkingSubmitting ? <RefreshCw size={14} className="animate-spin" /> : null}
                        <span>Add Accounts ({selectedDiscoveredAccs.length})</span>
                      </button>
                      <button
                        type="button"
                        disabled={linkingSubmitting}
                        onClick={() => setResolvedAccounts([])}
                        className="px-4 py-3 border border-slate-800 hover:bg-slate-900 text-slate-400 rounded-xl cursor-pointer transition-colors"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Conflict warning Move / Keep Confirm dialog --- */}
      <AnimatePresence>
        {conflictAccount !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => handleResolveConflictChoice('cancel')}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-950 shadow-2xl relative overflow-hidden z-10"
            >
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
                  <ShieldAlert size={24} />
                </div>
                <h3 className="text-lg font-bold font-outfit text-slate-100">Conflict Detected</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The account <span className="text-red-400 font-bold">@{conflictAccount.username}</span> already exists in group <span className="text-purple-400 font-bold">'{conflictGroupName}'</span>.
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => handleResolveConflictChoice('move')}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Move to Current Group
                  </button>
                  <button
                    onClick={() => handleResolveConflictChoice('keep')}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold rounded-xl text-xs border border-slate-800 transition-colors cursor-pointer"
                  >
                    Keep Existing Group
                  </button>
                  <button
                    onClick={() => handleResolveConflictChoice('cancel')}
                    className="w-full py-2.5 border border-transparent text-slate-500 hover:text-slate-300 text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Dialog Modal (Group tab accounts list trigger) */}
      <AnimatePresence>
        {editDialogOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditDialogOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-md rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900">
                <h3 className="text-xl font-bold font-outfit text-slate-100">Update Credentials: @{editUsername}</h3>
              </div>

              <form onSubmit={handleEditSubmit}>
                <div className="p-6 space-y-4">
                  <p className="text-xs text-slate-500">Update credentials parameters. Leave fields blank to keep existing parameters unchanged.</p>
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">New Page Access Token</label>
                    <input
                      type="password"
                      value={editAccessToken}
                      onChange={(e) => setEditAccessToken(e.target.value)}
                      placeholder="Starts with EAA..."
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Facebook Page ID</label>
                    <input
                      type="text"
                      value={editPageId}
                      onChange={(e) => setEditPageId(e.target.value)}
                      placeholder="e.g. 10485769213"
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-900 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditDialogOpen(false)}
                    className="px-4 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 font-semibold rounded-xl text-sm transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="px-5 py-2 gradient-btn text-slate-950 font-bold rounded-xl text-sm hover:shadow-lg transition-all cursor-pointer flex items-center justify-center disabled:opacity-50"
                  >
                    {editSubmitting ? (
                      <RefreshCw size={14} className="animate-spin text-slate-950" />
                    ) : "Save Changes"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <AnimatePresence>
        {deleteId !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteId(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-sm rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900 flex items-center gap-2 text-amber-400">
                <AlertTriangle size={18} />
                <h3 className="text-base font-bold font-outfit text-slate-100">Confirm Soft Disconnect</h3>
              </div>
              <div className="p-6">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Are you sure you want to disconnect this Instagram account? The profile will be soft-deleted and marked as Disconnected. All associated publishing history, scheduled posts, media files, and settings will remain safely preserved in the database.
                </p>
              </div>
              <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-900 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteId(null)}
                  className="px-4 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition-all cursor-pointer shadow-md hover:shadow-lg"
                >
                  Confirm Soft Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Global Follow Management Overlay Modal --- */}
      <AnimatePresence>
        {showFollowModal && (
          <div className="fixed inset-0 z-40 overflow-y-auto flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFollowModal(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              className="glass-panel w-full max-w-7xl rounded-2xl border border-slate-900 bg-slate-950 shadow-2xl relative overflow-hidden flex flex-col z-10 max-h-[90vh]"
            >
              <div className="px-6 py-4 border-b border-slate-900 flex justify-between items-center bg-slate-950/40">
                <h2 className="text-lg font-bold font-outfit text-slate-100 flex items-center gap-2">
                  <Users size={18} className="text-purple-400" />
                  <span>Global Follow Management Hub</span>
                </h2>
                <button
                  onClick={() => setShowFollowModal(false)}
                  className="text-slate-500 hover:text-slate-300 p-1 hover:bg-slate-900 rounded-lg cursor-pointer transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <FollowManagement onClose={() => setShowFollowModal(false)} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Ownership Modal */}
      <AnimatePresence>
        {transferOwnerAccId !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setTransferOwnerAccId(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-sm rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900">
                <h3 className="text-lg font-bold font-outfit text-slate-100">Transfer Profile Ownership</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-slate-400">Select the new designated owner for this linked Instagram account from the list below:</p>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select User</label>
                  <select
                    value={newOwnerId || ''}
                    onChange={(e) => setNewOwnerId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-xl outline-none focus:border-purple-500/50 cursor-pointer"
                  >
                    {systemUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-900 flex justify-end gap-2">
                <button
                  onClick={() => setTransferOwnerAccId(null)}
                  className="px-4 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransferSubmit}
                  className="px-5 py-2 bg-purple-500 text-slate-950 font-black rounded-xl text-xs transition-all cursor-pointer shadow-md hover:shadow-lg"
                >
                  Transfer Owner
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sanitized Basic Info Modal */}
      <AnimatePresence>
        {viewInfoAcc !== null && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewInfoAcc(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-md rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900 flex justify-between items-center bg-slate-950/40">
                <h3 className="text-base font-bold font-outfit text-slate-100 flex items-center gap-2">
                  <Shield size={16} className="text-purple-400" />
                  <span>Sanitized Account Profile</span>
                </h3>
                <button onClick={() => setViewInfoAcc(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex items-center gap-4 p-3 bg-slate-900/50 border border-slate-800 rounded-xl">
                  <img src={viewInfoAcc.profile_picture || "https://placekitten.com/200/200"} className="w-12 h-12 rounded-full object-cover border border-purple-500/30" alt="Profile" />
                  <div>
                    <h4 className="text-base font-black text-slate-100">@{viewInfoAcc.instagram_username}</h4>
                    <p className="text-xs text-slate-400">{viewInfoAcc.business_name || "Instagram Account"}</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500">Account Owner</span>
                    <span className="text-slate-200 font-bold">{viewInfoAcc.owner_name || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500">Group Name</span>
                    <span className="text-purple-400 font-bold">{viewInfoAcc.group_name || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500">Account Status</span>
                    <span className={`font-bold ${viewInfoAcc.status === 'Connected' ? 'text-green-400' : 'text-red-400'}`}>
                      {viewInfoAcc.status === 'Connected' ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500">Followers Count</span>
                    <span className="text-slate-200 font-mono font-bold">{viewInfoAcc.followers_count.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500">Publishing Availability</span>
                    <span className="text-green-400 font-bold">Enabled for Organization</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-400 flex items-start gap-2">
                  <Lock size={14} className="mt-0.5 shrink-0" />
                  <span>Access tokens, credentials, and settings are hidden for privacy protection.</span>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-900 flex justify-end">
                <button
                  onClick={() => setViewInfoAcc(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
