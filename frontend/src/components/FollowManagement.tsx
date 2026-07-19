import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { 
  Users, RefreshCw, CheckCircle2, UserPlus, Eye, Search, AlertCircle, ArrowRight, ShieldCheck, Play,
  FolderOpen, Layers, UserCheck, AlertOctagon, History, Calendar, Info, ShieldAlert, BadgeCheck, ExternalLink, Settings as SettingsIcon, LayoutGrid
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface GlobalAccount {
  id: number;
  username: string;
  profile_picture: string | null;
  facebook_page_name: string | null;
  status: string;
  followers_count: number;
  group_name: string;
  last_synced: string | null;
}

interface ActivityLog {
  id: number;
  action: string;
  description: string;
  created_at: string;
}

interface FollowerFollowingRecord {
  id: number;
  username: string;
  display_name: string | null;
  is_verified: boolean;
  account_type: string | null;
  profile_picture: string;
  last_synced: string;
}

interface FollowManagementProps {
  onClose?: () => void;
}

type TabType = 'dashboard' | 'accounts' | 'followers-following' | 'activity' | 'settings';

export default function FollowManagement({ onClose }: FollowManagementProps) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [accounts, setAccounts] = useState<GlobalAccount[]>([]);
  const [relationships, setRelationships] = useState<Record<string, string>>({});
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Tab 1 (Dashboard) / Tab 2 (Accounts) filters
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedAccIds, setSelectedAccIds] = useState<number[]>([]);

  // Sequential Wizard Review Modal states
  const [reviewList, setReviewList] = useState<GlobalAccount[]>([]);
  const [reviewIndex, setReviewIndex] = useState(-1);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  // Tab 3 (Followers & Following) states
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [followersList, setFollowersList] = useState<FollowerFollowingRecord[]>([]);
  const [followingList, setFollowingList] = useState<FollowerFollowingRecord[]>([]);
  
  const [followersTotal, setFollowersTotal] = useState(0);
  const [followingTotal, setFollowingTotal] = useState(0);
  const [followersPage, setFollowersPage] = useState(1);
  const [followingPage, setFollowingPage] = useState(1);

  const [followersSearch, setFollowersSearch] = useState('');
  const [followingSearch, setFollowingSearch] = useState('');
  const [followersVerified, setFollowersVerified] = useState<string>('');
  const [followingVerified, setFollowingVerified] = useState<string>('');
  const [followersType, setFollowersType] = useState<string>('');
  const [followingType, setFollowingType] = useState<string>('');

  const [followersSyncTime, setFollowersSyncTime] = useState<string | null>(null);
  const [followingSyncTime, setFollowingSyncTime] = useState<string | null>(null);

  const [apiSupported, setApiSupported] = useState<boolean>(true);
  const [apiMessage, setApiMessage] = useState<string>('');

  const [syncingData, setSyncingData] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  useEffect(() => {
    fetchGlobalRelationships();
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      fetchFollowers();
      fetchFollowing();
    }
  }, [
    selectedAccountId, 
    followersPage, followingPage, 
    followersSearch, followingSearch, 
    followersVerified, followingVerified,
    followersType, followingType
  ]);

  const fetchGlobalRelationships = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/groups/follow/relationships-all`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setAccounts(res.data.accounts);
      setRelationships(res.data.relationships);
      setActivityLogs(res.data.activity_logs || []);
      if (res.data.accounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(res.data.accounts[0].id);
      }
    } catch (err: any) {
      setError('Failed to fetch global follow relations.');
    } finally {
      setLoading(false);
    }
  };

  const fetchFollowers = async () => {
    if (!selectedAccountId) return;
    try {
      const res = await axios.get(`${API_URL}/follow-management/${selectedAccountId}/followers`, {
        params: {
          search: followersSearch || undefined,
          verified: followersVerified === 'true' ? true : followersVerified === 'false' ? false : undefined,
          account_type: followersType || undefined,
          page: followersPage,
          limit: 5
        },
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.data.supported === false) {
        setApiSupported(false);
        setApiMessage(res.data.message);
      } else {
        setApiSupported(true);
        setFollowersList(res.data.records);
        setFollowersTotal(res.data.total);
        setFollowersSyncTime(res.data.last_sync);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFollowing = async () => {
    if (!selectedAccountId) return;
    try {
      const res = await axios.get(`${API_URL}/follow-management/${selectedAccountId}/following`, {
        params: {
          search: followingSearch || undefined,
          verified: followingVerified === 'true' ? true : followingVerified === 'false' ? false : undefined,
          account_type: followingType || undefined,
          page: followingPage,
          limit: 5
        },
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.data.supported === false) {
        setApiSupported(false);
        setApiMessage(res.data.message);
      } else {
        setApiSupported(true);
        setFollowingList(res.data.records);
        setFollowingTotal(res.data.total);
        setFollowingSyncTime(res.data.last_sync);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSyncFollowersFollowing = async () => {
    if (!selectedAccountId) return;
    setSyncingData(true);
    setSyncProgress(25);
    try {
      const res = await axios.post(`${API_URL}/follow-management/${selectedAccountId}/sync`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSyncProgress(75);
      if (res.data.supported === false) {
        setApiSupported(false);
        setApiMessage(res.data.message);
      } else {
        setSuccessMsg(res.data.message || 'Synchronization complete.');
        setFollowersPage(1);
        setFollowingPage(1);
        await Promise.all([fetchFollowers(), fetchFollowing()]);
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (e) {
      setError('Sync failed.');
    } finally {
      setSyncProgress(100);
      setTimeout(() => {
        setSyncingData(false);
        setSyncProgress(0);
      }, 500);
    }
  };

  const handleCheckFollowsGlobal = async () => {
    setAuditing(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await axios.post(`${API_URL}/groups/follow/check-all`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccessMsg(res.data.detail || 'Global follow audits complete.');
      fetchGlobalRelationships();
    } catch (err: any) {
      setError('Global follow check auditing failed.');
    } finally {
      setAuditing(false);
    }
  };

  const toggleSelectAccount = (id: number) => {
    if (selectedAccIds.includes(id)) {
      setSelectedAccIds(selectedAccIds.filter(x => x !== id));
    } else {
      setSelectedAccIds([...selectedAccIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedAccIds.length === filteredAccounts.length) {
      setSelectedAccIds([]);
    } else {
      setSelectedAccIds(filteredAccounts.map(a => a.id));
    }
  };

  const handleStartReview = () => {
    const list = accounts.filter(acc => selectedAccIds.includes(acc.id));
    if (list.length === 0) return;
    setReviewList(list);
    setReviewIndex(0);
    setIsReviewOpen(true);
  };

  const handleOpenInstagramInTab = async (username: string) => {
    window.open(`https://instagram.com/${username}`, '_blank');
    try {
      await axios.post(`${API_URL}/groups/follow/log-action`, null, {
        params: { username },
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const res = await axios.get(`${API_URL}/groups/follow/relationships-all`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setActivityLogs(res.data.activity_logs || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleNextReview = () => {
    if (reviewIndex + 1 < reviewList.length) {
      setReviewIndex(reviewIndex + 1);
    } else {
      setIsReviewOpen(false);
      setSelectedAccIds([]);
      setSuccessMsg('Profile review complete. All selected accounts audits finished.');
    }
  };

  const uniqueGroups = Array.from(new Set(accounts.map(a => a.group_name)));
  const totalGroupsCount = uniqueGroups.filter(g => g !== 'Unassigned').length || 0;
  const totalConnected = accounts.length;
  const activeCount = accounts.filter(a => a.status === 'Connected').length;
  const expiredCount = totalConnected - activeCount;

  const filteredAccounts = accounts.filter(a => {
    const matchesSearch = a.username.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (a.facebook_page_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = groupFilter === '' || a.group_name === groupFilter;
    const matchesStatus = statusFilter === '' || a.status === statusFilter;
    return matchesSearch && matchesGroup && matchesStatus;
  });

  const selectedAccountInfo = accounts.find(a => a.id === selectedAccountId);

  return (
    <div className="space-y-6">
      
      {/* Sub-tab Navigation Bar */}
      <div className="flex border-b border-slate-900 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-950/20 rounded-t-xl overflow-x-auto">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-5 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'dashboard' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
          }`}
        >
          <LayoutGrid size={13} />
          <span>Dashboard</span>
        </button>
        <button
          onClick={() => setActiveTab('accounts')}
          className={`px-5 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'accounts' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
          }`}
        >
          <Users size={13} />
          <span>Accounts Matrix</span>
        </button>
        <button
          onClick={() => setActiveTab('followers-following')}
          className={`px-5 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'followers-following' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
          }`}
        >
          <Users size={13} />
          <span>Followers & Following</span>
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-5 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'activity' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
          }`}
        >
          <History size={13} />
          <span>Activity Log</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-5 py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'settings' ? 'border-purple-500 text-purple-400 bg-slate-900/10' : 'border-transparent hover:text-slate-300'
          }`}
        >
          <SettingsIcon size={13} />
          <span>Settings</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold rounded-xl flex items-center gap-2">
          <CheckCircle2 size={14} />
          <span>{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl flex items-center gap-2">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* --- DASHBOARD TAB PANEL --- */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <FolderOpen size={10} className="text-purple-400" />
                <span>Total Groups</span>
              </span>
              <span className="text-xl font-black text-slate-200 mt-1">{totalGroupsCount}</span>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <Layers size={10} className="text-blue-400" />
                <span>Connected Profiles</span>
              </span>
              <span className="text-xl font-black text-slate-200 mt-1">{totalConnected}</span>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <UserCheck size={10} className="text-green-400" />
                <span>Active Tokens</span>
              </span>
              <span className="text-xl font-black text-green-400 mt-1">{activeCount}</span>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <AlertOctagon size={10} className="text-red-400" />
                <span>Expired Tokens</span>
              </span>
              <span className="text-xl font-black text-red-400 mt-1">{expiredCount}</span>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-slate-900 bg-slate-900/10 flex flex-col justify-between col-span-2 lg:col-span-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <History size={10} className="text-purple-400" />
                <span>Sync Time</span>
              </span>
              <span className="text-xs font-mono font-bold text-slate-400 mt-1">Today</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900/10 p-4 border border-slate-900 rounded-xl gap-4">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-300 font-outfit">Relationships Overview</h3>
              <p className="text-[11px] text-slate-500">Cross-reference follow status matrix globally for connected profiles.</p>
            </div>
            <button
              onClick={handleCheckFollowsGlobal}
              disabled={auditing}
              className="px-4 py-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={12} className={auditing ? 'animate-spin' : ''} />
              <span>Check Follow Status</span>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <RefreshCw size={24} className="animate-spin text-purple-500 mx-auto" />
            </div>
          ) : (
            <div className="border border-slate-900 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-900 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-3">Profile</th>
                    <th className="p-3">Workspace Group</th>
                    <th className="p-3">Follows Others</th>
                    <th className="p-3">Followed By Others</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map(a => {
                    const followingOthers = accounts.filter(b => b.id !== a.id).map(b => {
                      const status = relationships[`${a.id}-${b.id}`] || 'Unknown';
                      return { username: b.username, status };
                    });

                    const followedByOthers = accounts.filter(b => b.id !== a.id).map(b => {
                      const status = relationships[`${b.id}-${a.id}`] || 'Unknown';
                      return { username: b.username, status };
                    });

                    return (
                      <tr key={a.id} className="border-b border-slate-900 hover:bg-slate-900/20 text-slate-300">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <img src={a.profile_picture || "https://placekitten.com/200/200"} className="w-7 h-7 rounded-full object-cover" alt="Pic" />
                            <span className="font-bold">@{a.username}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="text-slate-400">{a.group_name}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {followingOthers.map(peer => (
                              <span key={peer.username} className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                peer.status === 'Following' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                @{peer.username}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {followedByOthers.map(peer => (
                              <span key={peer.username} className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                peer.status === 'Following' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                @{peer.username}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            a.status === 'Connected' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- ACCOUNTS TAB PANEL --- */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-3.5 text-slate-600" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search profiles..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-xs rounded-lg text-slate-200 placeholder:text-slate-600"
              />
            </div>
            
            <button
              onClick={handleStartReview}
              disabled={selectedAccIds.length === 0}
              className="px-4 py-2 gradient-btn text-slate-950 font-black text-xs rounded-xl flex items-center gap-1.5 disabled:opacity-30"
            >
              <Play size={12} className="text-slate-950" />
              <span>Manual Review Selected ({selectedAccIds.length})</span>
            </button>
          </div>

          <div className="border border-slate-900 rounded-xl overflow-hidden text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-900 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-3 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={selectedAccIds.length === filteredAccounts.length}
                      onChange={toggleSelectAll}
                      className="accent-purple-500 cursor-pointer"
                    />
                  </th>
                  <th className="p-3">Instagram Username</th>
                  <th className="p-3">Group Name</th>
                  <th className="p-3">Facebook Page</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Sync</th>
                  <th className="p-3 text-center">Open Profile</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map(a => (
                  <tr key={a.id} className="border-b border-slate-900 hover:bg-slate-900/20 text-slate-300">
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedAccIds.includes(a.id)}
                        onChange={() => toggleSelectAccount(a.id)}
                        className="accent-purple-500 cursor-pointer"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <img src={a.profile_picture || "https://placekitten.com/200/200"} className="w-7 h-7 rounded-full object-cover" alt="Pic" />
                        <span className="font-bold">@{a.username}</span>
                      </div>
                    </td>
                    <td className="p-3">{a.group_name}</td>
                    <td className="p-3 text-slate-400">{a.facebook_page_name}</td>
                    <td className="p-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        a.status === 'Connected' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-[10px]">
                      {a.last_synced ? new Date(a.last_synced).toLocaleString() : 'Never'}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleOpenInstagramInTab(a.username)}
                        className="px-2.5 py-1 text-[10px] font-bold border border-slate-800 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer flex items-center gap-1 mx-auto"
                      >
                        <ExternalLink size={10} />
                        <span>Open</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- FOLLOWERS & FOLLOWING TAB PANEL --- */}
      {activeTab === 'followers-following' && (
        <div className="space-y-6">
          
          {/* Account profile info selection box */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/10 p-5 border border-slate-900 rounded-xl">
            <div className="flex items-center gap-3">
              <select
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value ? Number(e.target.value) : '');
                  setFollowersPage(1);
                  setFollowingPage(1);
                }}
                className="bg-slate-900 border border-slate-800 text-xs font-bold rounded-lg text-slate-200 outline-none px-3 py-2 cursor-pointer focus:border-purple-500/50"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>@{acc.username} ({acc.group_name})</option>
                ))}
              </select>

              {selectedAccountInfo && (
                <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-bold border border-purple-500/10">
                    {selectedAccountInfo.group_name}
                  </span>
                  <span className={`px-2 py-0.5 rounded font-bold ${
                    selectedAccountInfo.status === 'Connected' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {selectedAccountInfo.status}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {syncingData && (
                <div className="w-24 bg-slate-900 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${syncProgress}%` }} />
                </div>
              )}
              <button
                onClick={handleSyncFollowersFollowing}
                disabled={syncingData || !selectedAccountId}
                className="px-4 py-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={syncingData ? 'animate-spin' : ''} />
                <span>{syncingData ? 'Synchronizing...' : 'Refresh Data'}</span>
              </button>
            </div>
          </div>

          {!apiSupported ? (
            <div className="p-8 text-center bg-red-950/20 border border-red-900/40 rounded-2xl max-w-xl mx-auto space-y-3">
              <ShieldAlert size={36} className="text-red-400 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">API Sync Unsupported</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Follower and Following lists are not available through the currently configured Instagram API.
              </p>
              <div className="p-3 bg-slate-900/30 rounded-lg text-[10px] text-slate-500 text-left flex items-start gap-2">
                <Info size={14} className="text-slate-600 shrink-0 mt-0.5" />
                <span>
                  The official Meta Instagram Graph API restricts access to user relation connections endpoints for production Business tokens. Sandbox and mock tokens support this visual dashboard interface for test cases.
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Followers Column (Left) */}
              <div className="glass-panel p-5 rounded-2xl border border-slate-900 space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-bold text-slate-200 font-outfit">Followers ({followersTotal})</h4>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Last sync: {followersSyncTime ? new Date(followersSyncTime).toLocaleTimeString() : 'Never'}
                  </span>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="relative col-span-1 sm:col-span-1">
                    <Search size={12} className="absolute left-2.5 top-2.5 text-slate-600" />
                    <input
                      type="text"
                      value={followersSearch}
                      onChange={(e) => { setFollowersSearch(e.target.value); setFollowersPage(1); }}
                      placeholder="Search username..."
                      className="w-full pl-7 pr-3 py-1.5 bg-slate-900/50 border border-slate-800 outline-none text-[11px] rounded-lg text-slate-200"
                    />
                  </div>

                  <select
                    value={followersVerified}
                    onChange={(e) => { setFollowersVerified(e.target.value); setFollowersPage(1); }}
                    className="bg-slate-900 border border-slate-800 text-[11px] rounded-lg text-slate-300 outline-none px-2 py-1.5"
                  >
                    <option value="">All Verification</option>
                    <option value="true">Verified Badge</option>
                    <option value="false">Unverified</option>
                  </select>

                  <select
                    value={followersType}
                    onChange={(e) => { setFollowersType(e.target.value); setFollowersPage(1); }}
                    className="bg-slate-900 border border-slate-800 text-[11px] rounded-lg text-slate-300 outline-none px-2 py-1.5"
                  >
                    <option value="">All Account Types</option>
                    <option value="Business">Business</option>
                    <option value="Creator">Creator</option>
                    <option value="Personal">Personal</option>
                  </select>
                </div>

                {/* List */}
                <div className="space-y-2 min-h-[250px]">
                  {followersList.length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-12">No followers found.</p>
                  ) : (
                    followersList.map(r => (
                      <div key={r.id} className="p-3 bg-slate-900/30 border border-slate-900 rounded-xl flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <img src={r.profile_picture} className="w-8 h-8 rounded-full border border-slate-800" alt="Avatar" />
                          <div>
                            <div className="flex items-center gap-1 font-bold text-slate-300">
                              <span>@{r.username}</span>
                              {r.is_verified && <BadgeCheck size={12} className="text-blue-500 fill-blue-500/10" />}
                            </div>
                            <span className="text-[10px] text-slate-500 font-medium">{r.display_name}</span>
                          </div>
                        </div>

                        <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 font-mono text-[9px]">
                          {r.account_type}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Pagination */}
                {followersTotal > 5 && (
                  <div className="flex justify-center items-center gap-2 pt-2">
                    <button
                      disabled={followersPage === 1}
                      onClick={() => setFollowersPage(followersPage - 1)}
                      className="px-2 py-1 bg-slate-900 text-[10px] rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                    >
                      Prev
                    </button>
                    <span className="text-[10px] text-slate-500">Page {followersPage} of {Math.ceil(followersTotal / 5)}</span>
                    <button
                      disabled={followersPage * 5 >= followersTotal}
                      onClick={() => setFollowersPage(followersPage + 1)}
                      className="px-2 py-1 bg-slate-900 text-[10px] rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                )}

              </div>

              {/* Following Column (Right) */}
              <div className="glass-panel p-5 rounded-2xl border border-slate-900 space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-bold text-slate-200 font-outfit">Following ({followingTotal})</h4>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Last sync: {followingSyncTime ? new Date(followingSyncTime).toLocaleTimeString() : 'Never'}
                  </span>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-2.5 text-slate-600" />
                    <input
                      type="text"
                      value={followingSearch}
                      onChange={(e) => { setFollowingSearch(e.target.value); setFollowingPage(1); }}
                      placeholder="Search username..."
                      className="w-full pl-7 pr-3 py-1.5 bg-slate-900/50 border border-slate-800 outline-none text-[11px] rounded-lg text-slate-200"
                    />
                  </div>

                  <select
                    value={followingVerified}
                    onChange={(e) => { setFollowingVerified(e.target.value); setFollowingPage(1); }}
                    className="bg-slate-900 border border-slate-800 text-[11px] rounded-lg text-slate-300 outline-none px-2 py-1.5"
                  >
                    <option value="">All Verification</option>
                    <option value="true">Verified Badge</option>
                    <option value="false">Unverified</option>
                  </select>

                  <select
                    value={followingType}
                    onChange={(e) => { setFollowingType(e.target.value); setFollowingPage(1); }}
                    className="bg-slate-900 border border-slate-800 text-[11px] rounded-lg text-slate-300 outline-none px-2 py-1.5"
                  >
                    <option value="">All Account Types</option>
                    <option value="Business">Business</option>
                    <option value="Creator">Creator</option>
                    <option value="Personal">Personal</option>
                  </select>
                </div>

                {/* List */}
                <div className="space-y-2 min-h-[250px]">
                  {followingList.length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-12">No following users found.</p>
                  ) : (
                    followingList.map(r => (
                      <div key={r.id} className="p-3 bg-slate-900/30 border border-slate-900 rounded-xl flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <img src={r.profile_picture} className="w-8 h-8 rounded-full border border-slate-800" alt="Avatar" />
                          <div>
                            <div className="flex items-center gap-1 font-bold text-slate-300">
                              <span>@{r.username}</span>
                              {r.is_verified && <BadgeCheck size={12} className="text-blue-500 fill-blue-500/10" />}
                            </div>
                            <span className="text-[10px] text-slate-500 font-medium">{r.display_name}</span>
                          </div>
                        </div>

                        <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 font-mono text-[9px]">
                          {r.account_type}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Pagination */}
                {followingTotal > 5 && (
                  <div className="flex justify-center items-center gap-2 pt-2">
                    <button
                      disabled={followingPage === 1}
                      onClick={() => setFollowingPage(followingPage - 1)}
                      className="px-2 py-1 bg-slate-900 text-[10px] rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                    >
                      Prev
                    </button>
                    <span className="text-[10px] text-slate-500">Page {followingPage} of {Math.ceil(followingTotal / 5)}</span>
                    <button
                      disabled={followingPage * 5 >= followingTotal}
                      onClick={() => setFollowingPage(followingPage + 1)}
                      className="px-2 py-1 bg-slate-900 text-[10px] rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                )}

              </div>

            </div>
          )}

        </div>
      )}

      {/* --- ACTIVITY LOG TAB PANEL --- */}
      {activeTab === 'activity' && (
        <div className="glass-panel p-5 rounded-2xl border border-slate-900 bg-slate-950/20 max-w-xl mx-auto space-y-4">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <History size={12} className="text-purple-400" />
            <span>Auditing Activity Log</span>
          </h4>
          
          {activityLogs.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">No follow management actions logged yet.</p>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {activityLogs.map(log => (
                <div key={log.id} className="p-3 bg-slate-900/30 border border-slate-900 rounded-lg space-y-1">
                  <div className="flex justify-between items-center text-[9px]">
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 font-bold font-mono">
                      {log.action}
                    </span>
                    <span className="text-slate-500 font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium leading-relaxed">{log.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- SETTINGS TAB PANEL --- */}
      {activeTab === 'settings' && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-900 max-w-md mx-auto space-y-4">
          <h3 className="text-sm font-bold text-slate-200">Follower Directory Settings</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Configure default settings and diagnostic parameters for auditing linked Instagram accounts relationships.
          </p>

          <div className="space-y-3 pt-3 border-t border-slate-900 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Automatic Backups</span>
              <span className="text-[10px] text-slate-500 font-mono font-bold">Enabled</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Sync Retention Limit</span>
              <span className="text-[10px] text-slate-500 font-mono font-bold">30 Days</span>
            </div>
          </div>
        </div>
      )}

      {/* --- Sequential Wizard Review Modal stepper dialog --- */}
      <AnimatePresence>
        {isReviewOpen && reviewIndex >= 0 && reviewIndex < reviewList.length && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-md rounded-2xl border border-purple-500/25 bg-slate-950 shadow-2xl relative overflow-hidden flex flex-col z-10 p-6 text-center space-y-5"
            >
              <h3 className="text-md font-bold font-outfit text-slate-100 uppercase tracking-wide">Manual Follow Review Wizard</h3>
              
              <div className="space-y-3">
                <img 
                  src={reviewList[reviewIndex].profile_picture || "https://placekitten.com/200/200"} 
                  className="w-20 h-20 rounded-full object-cover mx-auto border-2 border-purple-500" 
                  alt="Profile" 
                />
                <div>
                  <h4 className="text-lg font-black text-slate-200">@{reviewList[reviewIndex].username}</h4>
                  <span className="text-xs text-purple-400 font-bold font-mono block mb-1">Group: {reviewList[reviewIndex].group_name}</span>
                  <span className="text-xs text-slate-500">{reviewList[reviewIndex].facebook_page_name}</span>
                </div>
              </div>

              {/* Progress info */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Profiles Reviewed: {reviewIndex} / {reviewList.length}</span>
                  <span>Remaining: {reviewList.length - reviewIndex}</span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-purple-500 h-full transition-all duration-300"
                    style={{ width: `${(reviewIndex / reviewList.length) * 100}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => handleOpenInstagramInTab(reviewList[reviewIndex].username)}
                  className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg hover:shadow-purple-500/10"
                >
                  <Eye size={12} />
                  <span>Open Instagram Profile in New Tab</span>
                </button>
                
                <button
                  onClick={handleNextReview}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl text-xs border border-slate-800 transition-all cursor-pointer flex items-center justify-center gap-1"
                >
                  <span>{reviewIndex + 1 === reviewList.length ? 'Finish Audit' : 'Next Account'}</span>
                  <ArrowRight size={12} />
                </button>
                
                <button
                  onClick={() => setIsReviewOpen(false)}
                  className="w-full py-2.5 text-slate-500 hover:text-slate-300 text-xs transition-colors cursor-pointer"
                >
                  Cancel Review
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
