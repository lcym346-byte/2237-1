/* 中文備註：js/core/store.js，此檔已加入中文說明，方便後續維護。 */
import { KEYS, load, save } from './storage.js';
import { id } from './utils.js';

function moduleAttachByName(name){
  return {moduleId:'name:'+name, requiredOverride:null};
}

export const defaultCategories = ['未分類','主餐','炸物','飲料','小菜','套餐','甜點'];
export const defaultModules = [
  {id:id(), name:'甜度', selection:'single', required:true, options:[
    {id:id(), name:'正常甜', price:0, enabled:true},
    {id:id(), name:'半糖', price:0, enabled:true},
    {id:id(), name:'微糖', price:0, enabled:true},
    {id:id(), name:'無糖', price:0, enabled:true},
  ]},
  {id:id(), name:'冰量', selection:'single', required:true, options:[
    {id:id(), name:'正常冰', price:0, enabled:true},
    {id:id(), name:'少冰', price:0, enabled:true},
    {id:id(), name:'去冰', price:0, enabled:true},
  ]},
  {id:id(), name:'辣度', selection:'single', required:false, options:[
    {id:id(), name:'不辣', price:0, enabled:true},
    {id:id(), name:'小辣', price:0, enabled:true},
    {id:id(), name:'中辣', price:0, enabled:true},
    {id:id(), name:'大辣', price:0, enabled:true},
  ]},
  {id:id(), name:'灑粉', selection:'multi', required:false, options:[
    {id:id(), name:'胡椒粉', price:0, enabled:true},
    {id:id(), name:'梅粉', price:5, enabled:true},
    {id:id(), name:'海苔粉', price:5, enabled:true},
  ]},
];
export const defaultProducts = [
  {id:id(), name:'雞排', price:70, category:'炸物', enabled:true, aliases:['香雞排','大雞排'], modules:[moduleAttachByName('辣度'), moduleAttachByName('灑粉')], sortOrder:0},
  {id:id(), name:'薯條', price:50, category:'炸物', enabled:true, aliases:[], modules:[moduleAttachByName('灑粉')], sortOrder:1},
  {id:id(), name:'紅茶', price:30, category:'飲料', enabled:true, aliases:[], modules:[moduleAttachByName('甜度'), moduleAttachByName('冰量')], sortOrder:2},
];

export function normalizeModules(mods){
  return (mods||[]).map(m=>({
    id:m.id || id(),
    name:m.name || '未命名模組',
    selection:m.selection === 'multi' ? 'multi' : 'single',
    required:m.required !== false,
    options:(m.options||[]).map(o=>({
      id:o.id || id(),
      name:o.name || '',
      price:Number(o.price||0),
      enabled:o.enabled !== false,
    })),
  }));
}

export function normalizeProducts(products, modules, categories){
  return (products||[]).map((p, index)=>{
    const mappedModules = (p.modules||[]).map(att=>{
      if(att.moduleId && att.moduleId.startsWith('name:')){
        const mod = modules.find(m=>m.name === att.moduleId.slice(5));
        return mod ? {moduleId:mod.id, requiredOverride:att.requiredOverride ?? null} : null;
      }
      const exists = modules.find(m=>m.id===att.moduleId);
      return exists ? {moduleId:att.moduleId, requiredOverride:att.requiredOverride ?? null} : null;
    }).filter(Boolean);
    return {
      id:p.id || id(),
      name:p.name || '',
      price:Number(p.price||0),
      category:categories.includes(p.category) ? p.category : '未分類',
      enabled:p.enabled !== false,
      aliases:Array.isArray(p.aliases)?p.aliases:[],
      image: typeof p.image === 'string' ? p.image : '',
      modules:mappedModules,
      sortOrder:Number.isFinite(Number(p.sortOrder)) ? Number(p.sortOrder) : index,
    };
  });
}

const loadedCategories = load(KEYS.CATEGORIES, defaultCategories);
const normalizedCategories = ['未分類', ...loadedCategories.filter(c => c && c !== '未分類')];
const loadedModules = normalizeModules(load(KEYS.MODULES, defaultModules));
const loadedProducts = normalizeProducts(load(KEYS.PRODUCTS, defaultProducts), loadedModules, normalizedCategories);

export const state = {
  categories: normalizedCategories,
  modules: loadedModules,
  products: loadedProducts,
  pendingProducts: load(KEYS.PENDING_PRODUCTS, []),
  orders: load(KEYS.ORDERS, []),
  settings: load(KEYS.SETTINGS, {selectedCategory:'全部', discountType:'amount', showProductImages:false}),
  reports: load(KEYS.REPORTS, {currentSession:null, sessions:[], savedSnapshots:[]}),
  cart: [],
  editModules: [],
  configTarget: null,
  currentSelections: {},
  editingOrderId: null,
  viewReportOrders: null,
  categoryManageTarget: null,
  categoryManageDraft: new Set(),
  moduleManageTarget: null,
  moduleManageDraft: new Set(),
  onlineIncomingOrders: [],
};

export function persistAll(){
  save(KEYS.CATEGORIES, state.categories);
  save(KEYS.MODULES, state.modules);
  save(KEYS.PRODUCTS, state.products);
  save(KEYS.PENDING_PRODUCTS, state.pendingProducts);
  save(KEYS.ORDERS, state.orders);
  save(KEYS.SETTINGS, state.settings);
  save(KEYS.REPORTS, state.reports);
}

export function seedDefaults(){
  state.categories = [...defaultCategories];
  state.modules = normalizeModules(defaultModules);
  state.products = normalizeProducts(defaultProducts, state.modules, state.categories);
  state.pendingProducts = [];
  state.orders = [];
  state.settings = {selectedCategory:'全部', discountType:'amount', showProductImages:false};
  state.reports = {currentSession:null, sessions:[], savedSnapshots:[]};
  state.cart = [];
  state.editModules = [];
  state.editingOrderId = null;
  state.viewReportOrders = null;
  persistAll();
}