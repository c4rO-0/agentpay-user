// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
const service={ActiveState:'active',UnitFileState:'enabled'};
const base={wallet:{locked:false,bound:true},walletService:service,runtimeService:service,runtime:{inventory:'complete',wallet:'available',orders:{total:0,settled:0,waiting:0,review:0,legacy:0,missingResult:0},issues:[]}};
const withRuntime=patch=>({...base,runtime:{...base.runtime,...patch}});
export const statusPanelCases=[
 ['ready',base],
 ...['SETTLED_RESULT_UNAVAILABLE','ORDER_CHECK_UNAVAILABLE','ORDER_NOT_FOUND','ORDER_IDENTITY_MISMATCH','ORDER_ID_UNRESOLVED','ORDER_STATE_CONFLICT','RECOVERY_RESULT_INVALID','SETTLEMENT_RESPONSE_INVALID'].map(code=>[code,withRuntime({orders:{total:1,settled:code==='SETTLED_RESULT_UNAVAILABLE'?1:0,waiting:0,review:code==='SETTLED_RESULT_UNAVAILABLE'?0:1,missingResult:code==='SETTLED_RESULT_UNAVAILABLE'?1:0},issues:[{orderId:'0x'+'a'.repeat(64),code}]})]),
 ['locked', {...base,wallet:{locked:true,bound:true}}],
 ['locked-with-stale-observation',{...withRuntime({wallet:'unavailable',orders:{total:1,settled:0,waiting:1,review:0,legacy:1}}),wallet:{locked:true,bound:true}}],
 ['runtime-stopped',{...base,runtime:null,runtimeService:{ActiveState:'failed',UnitFileState:'disabled'}}],
 ['wallet-stopped',{...base,wallet:null,walletService:{ActiveState:'inactive',UnitFileState:'disabled'}}],
 ['wallet-unreachable',{...base,wallet:null}],
 ['runtime-unreachable',{...base,runtime:null}],
 ['old-runtime',{...base,runtime:null,runtimeUnsupported:true}],
 ['history-invalid',withRuntime({inventory:'blocked'})],
 ['observation-save-failed',withRuntime({storageError:true})],
 ['checking',withRuntime({inventory:'checking',wallet:'not_checked'})],
 ['permission-needed',{...base,wallet:{locked:false,bound:false}}],
 ['policy-migration',{...base,wallet:{locked:false,bound:true,policyMigrationPending:true}}],
 ['settings-invalid',{configurationError:true}],
 ['not-configured',{...base,walletService:{LoadState:'not-found'},runtimeService:{LoadState:'not-found'}}],
 ['mixed-startup',{...base,walletService:{LoadState:'not-found'},runtimeService:null}],
 ['temporary-startup',{...base,walletService:{LoadState:'loaded',UnitFileState:'enabled-runtime'},runtimeService:{LoadState:'masked',UnitFileState:'masked'}}],
 ['unknown-startup',{...base,walletService:null,runtimeService:null}],
 ['pending-orders',withRuntime({orders:{total:4,settled:2,waiting:2,review:0,legacy:1}})],
 ['order-issues',withRuntime({orders:{total:6,settled:3,waiting:1,review:2,legacy:1,missingResult:1},issues:['ORDER_NOT_FOUND','ORDER_STATE_CONFLICT','SETTLED_RESULT_UNAVAILABLE'].map((code,i)=>({orderId:'0x'+String(i+1).repeat(64),code}))})],
 ['many-orders',withRuntime({orders:{total:10000,settled:8000,waiting:1000,review:1000,legacy:9000}})]
];
