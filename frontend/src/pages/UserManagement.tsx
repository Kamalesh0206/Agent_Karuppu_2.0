import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Users, UserCheck, UserX, Ban, Clock, ShieldAlert, 
  Search, Filter, Edit, Trash2, Key, Eye, X, ChevronRight, AlertCircle 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URL } from '../config';

interface UserDetail {
  id: number;
  full_name: string;
  email: string | null;
  mobile_number: string | null;
  username: string;
  role: string;
  status: string;
  approval_status: string;
  approved_by: number | null;
  approved_at: string | null;
  rejected_by: number | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  disabled_at: string | null;
  suspended_at: string | null;
  last_login: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  suspended: number;
  admins: number;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0, pending: 0, approved: 0, disabled: 0, suspended: 0, admins: 0
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [loading, setLoading] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  
  // Drawer / Modals states
  const [activeDrawerUser, setActiveDrawerUser] = useState<UserDetail | null>(null);
  const [editUser, setEditUser] = useState<UserDetail | null>(null);
  const [rejectUserId, setRejectUserId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [resetPassUserId, setResetPassUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);

  const fetchUsersAndStats = async () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const statsRes = await axios.get(`${API_URL}/admin/users/stats`, { headers });
      setStats(statsRes.data);

      const usersRes = await axios.get(`${API_URL}/admin/users`, {
        headers,
        params: {
          search: search || undefined,
          status_filter: statusFilter || undefined,
          role_filter: roleFilter || undefined,
          sort_by: sortBy,
          sort_dir: sortDir,
          page,
          limit
        }
      });
      setUsers(usersRes.data);
    } catch (err) {
      console.error("Error fetching user management data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndStats();
  }, [search, statusFilter, roleFilter, sortBy, sortDir, page]);

  const handleAction = async (action: string, id: number, payload: any = {}) => {
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };
    try {
      if (action === 'approve') {
        await axios.post(`${API_URL}/admin/users/${id}/approve`, {}, { headers });
      } else if (action === 'reject') {
        await axios.post(`${API_URL}/admin/users/${id}/reject`, payload, { headers });
      } else if (action === 'disable') {
        await axios.post(`${API_URL}/admin/users/${id}/disable`, {}, { headers });
      } else if (action === 'enable') {
        await axios.post(`${API_URL}/admin/users/${id}/enable`, {}, { headers });
      } else if (action === 'suspend') {
        await axios.post(`${API_URL}/admin/users/${id}/suspend`, {}, { headers });
      } else if (action === 'delete') {
        await axios.delete(`${API_URL}/admin/users/${id}`, { headers });
      } else if (action === 'reset-password') {
        await axios.post(`${API_URL}/admin/users/${id}/reset-password`, payload, { headers });
      }
      fetchUsersAndStats();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Action failed.");
    }
  };

  const handleBulkAction = async (action: string) => {
    if (selectedUserIds.length === 0) return;
    if (action === 'delete') {
      if (!confirm("Are you sure you want to delete all selected users? This cannot be undone.")) return;
    }
    setLoading(true);
    for (const id of selectedUserIds) {
      await handleAction(action, id, action === 'reject' ? { rejection_reason: "Bulk Rejection" } : {});
    }
    setSelectedUserIds([]);
    fetchUsersAndStats();
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };
    try {
      await axios.put(`${API_URL}/admin/users/${editUser.id}`, {
        full_name: editUser.full_name,
        email: editUser.email,
        mobile_number: editUser.mobile_number,
        role: editUser.role,
        status: editUser.status
      }, { headers });
      setEditUser(null);
      fetchUsersAndStats();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Update failed.");
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string, text: string, icon: any }> = {
      'Pending Approval': { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-400', icon: <Clock size={12} /> },
      'Approved': { bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400', icon: <UserCheck size={12} /> },
      'Rejected': { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: <UserX size={12} /> },
      'Disabled': { bg: 'bg-slate-500/10 border-slate-500/20', text: 'text-slate-400', icon: <Ban size={12} /> },
      'Suspended': { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-400', icon: <ShieldAlert size={12} /> }
    };
    const b = badges[status] || badges['Pending Approval'];
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${b.bg} ${b.text}`}>
        {b.icon}
        <span>{status}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black font-outfit text-slate-100">User Management</h1>
          <p className="text-slate-400 text-xs">Manage user approvals, roles, and system permission levels</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { title: "Total Users", val: stats.total, icon: <Users size={16} />, color: "from-purple-500 to-indigo-500" },
          { title: "Pending Approval", val: stats.pending, icon: <Clock size={16} />, color: "from-yellow-500 to-orange-500" },
          { title: "Approved", val: stats.approved, icon: <UserCheck size={16} />, color: "from-green-500 to-emerald-500" },
          { title: "Disabled", val: stats.disabled, icon: <Ban size={16} />, color: "from-slate-500 to-gray-500" },
          { title: "Suspended", val: stats.suspended, icon: <ShieldAlert size={16} />, color: "from-orange-600 to-red-500" },
          { title: "System Admins", val: stats.admins, icon: <UserCheck size={16} />, color: "from-pink-500 to-purple-500" }
        ].map((item, idx) => (
          <div key={idx} className="glass-panel p-4 rounded-2xl border border-slate-800 flex items-center gap-4 relative overflow-hidden shadow-lg">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-slate-950 font-black shadow-inner`}>
              {item.icon}
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{item.title}</p>
              <h3 className="text-lg font-black text-slate-100">{item.val}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Directory Filter / Controls */}
      <div className="glass-panel p-4 rounded-3xl border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-purple-500/50"
            />
          </div>
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto items-center justify-end">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-xs font-bold rounded-xl text-slate-200 px-3 py-2 outline-none cursor-pointer focus:border-purple-500/50"
            >
              <option value="">All Statuses</option>
              <option value="Pending Approval">Pending Approval</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Disabled">Disabled</option>
              <option value="Suspended">Suspended</option>
            </select>
            
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-xs font-bold rounded-xl text-slate-200 px-3 py-2 outline-none cursor-pointer focus:border-purple-500/50"
            >
              <option value="">All Roles</option>
              <option value="Super Admin">Super Admin</option>
              <option value="Admin">Admin</option>
              <option value="User">User</option>
            </select>
          </div>
        </div>

        {/* Bulk Actions Console */}
        {selectedUserIds.length > 0 && (
          <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/20 px-4 py-3 rounded-2xl">
            <span className="text-xs font-bold text-purple-400">
              {selectedUserIds.length} users selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkAction('approve')}
                className="px-3 py-1.5 bg-green-500 text-slate-950 text-xs font-black rounded-lg hover:shadow-lg transition-all"
              >
                Approve
              </button>
              <button
                onClick={() => handleBulkAction('disable')}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-bold rounded-lg border border-slate-700"
              >
                Disable
              </button>
              <button
                onClick={() => handleBulkAction('delete')}
                className="px-3 py-1.5 bg-red-500 text-slate-950 text-xs font-black rounded-lg hover:shadow-lg transition-all"
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedUserIds([])}
                className="p-1.5 text-slate-400 hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-900 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedUserIds.length === users.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUserIds(users.map(u => u.id));
                      } else {
                        setSelectedUserIds([]);
                      }
                    }}
                    className="rounded border-slate-800 text-purple-500 focus:ring-purple-500 bg-slate-900"
                  />
                </th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-300" onClick={() => { setSortBy('full_name'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}>Full Name</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-300" onClick={() => { setSortBy('username'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}>Username</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-300 animate-pulse" onClick={() => { setSortBy('email'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}>Contact Info</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-300" onClick={() => { setSortBy('role'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}>Role</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-300" onClick={() => { setSortBy('status'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}>Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 text-xs text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500 font-bold">
                    Loading users list...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500 font-bold">
                    No users found matching query filters.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUserIds([...selectedUserIds, user.id]);
                          } else {
                            setSelectedUserIds(selectedUserIds.filter(id => id !== user.id));
                          }
                        }}
                        className="rounded border-slate-800 text-purple-500 focus:ring-purple-500 bg-slate-900"
                      />
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-200">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center font-black">
                          {user.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p>{user.full_name}</p>
                          <span className="text-[10px] text-slate-500">Reg: {new Date(user.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-purple-400">@{user.username}</td>
                    <td className="py-3.5 px-4">
                      <p className="text-slate-300 font-semibold">{user.email || 'N/A'}</p>
                      <p className="text-slate-500 font-mono text-[10px]">{user.mobile_number || 'N/A'}</p>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        user.role.includes('Admin') ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(user.status)}</td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setActiveDrawerUser(user)}
                          title="View Details"
                          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => setEditUser(user)}
                          title="Edit User"
                          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => setResetPassUserId(user.id)}
                          title="Reset Password"
                          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          <Key size={14} />
                        </button>
                        
                        {user.status === 'Pending Approval' && (
                          <>
                            <button
                              onClick={() => handleAction('approve', user.id)}
                              title="Approve User"
                              className="p-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-all"
                            >
                              <UserCheck size={14} />
                            </button>
                            <button
                              onClick={() => setRejectUserId(user.id)}
                              title="Reject User"
                              className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                            >
                              <UserX size={14} />
                            </button>
                          </>
                        )}

                        {user.status === 'Approved' && (
                          <button
                            onClick={() => handleAction('disable', user.id)}
                            title="Disable User"
                            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-red-400 transition-all"
                          >
                            <Ban size={14} />
                          </button>
                        )}

                        {(user.status === 'Disabled' || user.status === 'Suspended') && (
                          <button
                            onClick={() => handleAction('enable', user.id)}
                            title="Enable User"
                            className="p-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-all"
                          >
                            <UserCheck size={14} />
                          </button>
                        )}

                        {user.role !== 'Super Admin' && (
                          <button
                            onClick={() => setDeleteUserId(user.id)}
                            title="Delete User"
                            className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Dialog Modal */}
      {rejectUserId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="w-full max-w-md glass-panel p-6 rounded-2xl border border-slate-800">
            <h3 className="text-base font-black text-slate-100 mb-2">Reject User Registration</h3>
            <p className="text-slate-400 text-xs mb-4">Please provide a reason why this registration request is being rejected.</p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason..."
              className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-purple-500/50 mb-4 h-24 resize-none"
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => { setRejectUserId(null); setRejectionReason(''); }}
                className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-900 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleAction('reject', rejectUserId, { rejection_reason: rejectionReason });
                  setRejectUserId(null);
                  setRejectionReason('');
                }}
                className="px-4 py-2 bg-red-500 text-slate-950 font-black rounded-xl hover:shadow-lg transition-all"
              >
                Reject Request
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPassUserId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="w-full max-w-md glass-panel p-6 rounded-2xl border border-slate-800">
            <h3 className="text-base font-black text-slate-100 mb-2">Reset User Password</h3>
            <p className="text-slate-400 text-xs mb-4">Enter a new secure password for this user.</p>
            <input
              type="password"
              placeholder="Enter new password..."
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-purple-500/50 mb-4"
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => { setResetPassUserId(null); setNewPassword(''); }}
                className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-900 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newPassword.trim()) return;
                  handleAction('reset-password', resetPassUserId, { new_password: newPassword });
                  setResetPassUserId(null);
                  setNewPassword('');
                }}
                className="px-4 py-2 bg-purple-500 text-slate-950 font-black rounded-xl hover:shadow-lg transition-all"
              >
                Reset Password
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteUserId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="w-full max-w-md glass-panel p-6 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-2.5 text-red-400 mb-3">
              <AlertCircle size={20} />
              <h3 className="text-base font-black text-slate-100">Permanent User Deletion</h3>
            </div>
            <p className="text-slate-400 text-xs mb-4">Are you sure you want to permanently delete this user? This action cannot be undone and will delete all user configurations.</p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => setDeleteUserId(null)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-900 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleAction('delete', deleteUserId);
                  setDeleteUserId(null);
                }}
                className="px-4 py-2 bg-red-500 text-slate-950 font-black rounded-xl hover:shadow-lg transition-all"
              >
                Delete Account
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit User Modal Dialog */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="w-full max-w-md glass-panel p-6 rounded-2xl border border-slate-800">
            <h3 className="text-base font-black text-slate-100 mb-4">Edit User Account</h3>
            <form onSubmit={handleUpdateUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-bold mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={editUser.full_name}
                  onChange={(e) => setEditUser({ ...editUser, full_name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={editUser.email || ''}
                  onChange={(e) => setEditUser({ ...editUser, email: e.target.value || null })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5">Mobile Number</label>
                <input
                  type="text"
                  value={editUser.mobile_number || ''}
                  onChange={(e) => setEditUser({ ...editUser, mobile_number: e.target.value || null })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-purple-500/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5">System Role</label>
                  <select
                    value={editUser.role}
                    onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 outline-none cursor-pointer focus:border-purple-500/50"
                  >
                    <option value="User">User</option>
                    <option value="Admin">Admin</option>
                    <option value="Super Admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5">Account Status</label>
                  <select
                    value={editUser.status}
                    onChange={(e) => setEditUser({ ...editUser, status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 outline-none cursor-pointer focus:border-purple-500/50"
                  >
                    <option value="Pending Approval">Pending Approval</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Disabled">Disabled</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-900 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-500 text-slate-950 font-black rounded-xl hover:shadow-lg transition-all"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* User Details Drawer Sidepanel */}
      <AnimatePresence>
        {activeDrawerUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveDrawerUser(null)}
              className="fixed inset-0 bg-black z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 right-0 bottom-0 w-full sm:w-96 bg-slate-950 border-l border-slate-800 z-50 p-6 overflow-y-auto space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-4">
                <h3 className="text-base font-black font-outfit text-slate-100">User Account Detail</h3>
                <button
                  onClick={() => setActiveDrawerUser(null)}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="space-y-5 text-xs">
                {/* Avatar Banner */}
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center font-black text-2xl mx-auto shadow-inner">
                    {activeDrawerUser.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-200">{activeDrawerUser.full_name}</h4>
                    <p className="font-mono text-purple-400 font-bold">@{activeDrawerUser.username}</p>
                  </div>
                </div>

                {/* Profile attributes */}
                <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Email Address</span>
                    <p className="text-slate-300 font-semibold">{activeDrawerUser.email || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Mobile Number</span>
                    <p className="text-slate-300 font-mono font-semibold">{activeDrawerUser.mobile_number || 'N/A'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-900">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Role</span>
                      <p className="text-purple-400 font-bold mt-0.5">{activeDrawerUser.role}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Status</span>
                      <div className="mt-1">{getStatusBadge(activeDrawerUser.status)}</div>
                    </div>
                  </div>
                </div>

                {/* Status metadata logs */}
                <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
                  <h5 className="font-bold text-slate-300 border-b border-slate-900 pb-1.5">Approval History</h5>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Approval Status</span>
                    <p className="text-slate-300 font-semibold">{activeDrawerUser.approval_status}</p>
                  </div>
                  {activeDrawerUser.approved_at && (
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Approved At</span>
                      <p className="text-slate-400">{new Date(activeDrawerUser.approved_at).toLocaleString()}</p>
                    </div>
                  )}
                  {activeDrawerUser.rejection_reason && (
                    <div className="bg-red-500/5 border border-red-500/10 p-2.5 rounded-xl">
                      <span className="text-[10px] text-red-400 uppercase font-bold tracking-wider">Rejection Reason</span>
                      <p className="text-slate-300 mt-0.5">{activeDrawerUser.rejection_reason}</p>
                    </div>
                  )}
                </div>

                {/* Audit meta attributes */}
                <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
                  <h5 className="font-bold text-slate-300 border-b border-slate-900 pb-1.5">Last System Activity</h5>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Created At</span>
                    <p className="text-slate-400">{new Date(activeDrawerUser.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Last Login Session</span>
                    <p className="text-slate-300 font-semibold">
                      {activeDrawerUser.last_login ? new Date(activeDrawerUser.last_login).toLocaleString() : 'No active sessions logged.'}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
