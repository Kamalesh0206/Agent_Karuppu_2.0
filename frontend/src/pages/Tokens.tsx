import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { Key, Users, CheckCircle2, XCircle, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface InstagramAccount {
  id: number;
  instagram_username: string;
  profile_picture: string | null;
  followers_count: number;
  group_name: string | null;
}

interface UpdateResult {
  total: number;
  updated: number;
  failed: number;
  last_updated: string;
}

export default function Tokens() {
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [newToken, setNewToken] = useState('');
  const [validateBeforeUpdate, setValidateBeforeUpdate] = useState(true);
  
  const [validating, setValidating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | ''>('');
  
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);

  const fetchGroups = async () => {
    try {
      const response = await axios.get(`${API_URL}/groups`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setGroups(response.data);
      if (response.data.length > 0 && !selectedGroup) {
        setSelectedGroup(response.data[0]);
      }
    } catch (err) {
      console.error("Failed to load groups: ", err);
    }
  };

  const fetchAccountsInGroup = async () => {
    if (!selectedGroup) return;
    try {
      const response = await axios.get(`${API_URL}/groups/${selectedGroup}/accounts`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setAccounts(response.data);
    } catch (err) {
      console.error("Failed to load group accounts: ", err);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  useEffect(() => {
    fetchAccountsInGroup();
  }, [selectedGroup]);

  const handleValidateToken = async () => {
    if (!newToken.trim()) {
      setStatusType('error');
      setStatusMsg('New Access Token is required to validate.');
      return;
    }
    setValidating(true);
    setStatusMsg('');
    setStatusType('');
    try {
      const res = await axios.post(`${API_URL}/groups/validate-token`, {
        access_token: newToken.trim()
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setStatusType('success');
      setStatusMsg(`Token is VALID! Account: ${res.data.name || 'Meta App Integration'}`);
    } catch (err: any) {
      setStatusType('error');
      setStatusMsg(err.response?.data?.detail || "Invalid Access Token or expired.");
    } finally {
      setValidating(false);
    }
  };

  const handleUpdateGroupToken = async () => {
    if (!newToken.trim()) {
      setStatusType('error');
      setStatusMsg('New Access Token is required to update.');
      return;
    }
    setUpdating(true);
    setStatusMsg('');
    setStatusType('');
    setUpdateResult(null);
    try {
      const response = await axios.post(
        `${API_URL}/groups/${selectedGroup}/update-token`, 
        {
          access_token: newToken.trim(),
          validate_token: validateBeforeUpdate
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }
      );
      setUpdateResult(response.data);
      setStatusType('success');
      setStatusMsg('Group access tokens updated successfully.');
      setNewToken('');
      fetchAccountsInGroup();
    } catch (err: any) {
      setStatusType('error');
      setStatusMsg(err.response?.data?.detail || "Group update failed.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-black font-outfit text-slate-100 mb-1.5 flex items-center gap-2.5">
          <Key className="text-purple-400" />
          <span>Access Token Management</span>
        </h1>
        <p className="text-sm text-slate-400">Bulk update, check, and refresh Meta Access Tokens for entire groupings of Instagram accounts.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Token Management Panel */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-900 shadow-xl space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Credentials Refresher</h3>
          
          {/* Select Group */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Group</label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm outline-none focus:border-purple-500/50"
            >
              {groups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* New Token Text Area */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">New Access Token</label>
            <textarea
              rows={3}
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="Paste new EAA... Access Token here"
              className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-200 text-xs font-mono transition-all"
            />
          </div>

          {/* Validate before checkbox */}
          <label className="flex items-center gap-2.5 text-xs text-slate-400 cursor-pointer select-none">
            <input 
              type="checkbox"
              checked={validateBeforeUpdate}
              onChange={(e) => setValidateBeforeUpdate(e.target.checked)}
              className="accent-purple-500 rounded"
            />
            <span>Validate before updating</span>
          </label>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleValidateToken}
              disabled={validating || updating || !newToken}
              className="py-2.5 border border-slate-800 hover:bg-slate-900 rounded-xl text-xs font-bold text-slate-300 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {validating ? <RefreshCw size={14} className="animate-spin" /> : null}
              <span>Validate Token</span>
            </button>
            <button
              onClick={handleUpdateGroupToken}
              disabled={updating || validating || !newToken}
              className="py-2.5 gradient-btn text-slate-950 rounded-xl text-xs font-black transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {updating ? <RefreshCw size={14} className="animate-spin" /> : null}
              <span>Update Group Token</span>
            </button>
          </div>

          {/* Feedback message banner */}
          <AnimatePresence>
            {statusMsg && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`p-4 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  statusType === 'success'
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-400"
                }`}
              >
                {statusType === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <span>{statusMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Group Accounts Status List */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-900 shadow-xl space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Accounts in this Group</h3>
              <Users size={16} className="text-purple-400" />
            </div>
            
            {accounts.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-600">
                No accounts currently assigned to this group name. Edit account groups in "IG Accounts".
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between p-2.5 bg-slate-900/40 rounded-lg border border-slate-900">
                    <div className="flex items-center gap-2">
                      <img src={acc.profile_picture || "https://placekitten.com/200/200"} className="w-6 h-6 rounded-full object-cover" alt="Profile" />
                      <span className="text-xs font-bold text-slate-300">@{acc.instagram_username}</span>
                    </div>
                    <span className="text-[10px] text-green-400 flex items-center gap-1 font-bold">
                      <CheckCircle2 size={12} />
                      <span>Linked</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Results Summary Box */}
          <AnimatePresence>
            {updateResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mt-6 p-4 rounded-xl border border-slate-900 bg-slate-950 space-y-3"
              >
                <div className="border-b border-slate-900 pb-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Result
                  </h4>
                </div>
                
                <div className="space-y-1.5 text-xs font-semibold">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Accounts :</span>
                    <span className="text-slate-300 font-mono">{updateResult.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Updated :</span>
                    <span className="text-green-400 font-mono">{updateResult.updated}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Failed :</span>
                    <span className={`font-mono ${updateResult.failed > 0 ? "text-red-400" : "text-slate-300"}`}>
                      {updateResult.failed}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Updated :</span>
                    <span className="text-slate-300 font-mono">{updateResult.last_updated}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
