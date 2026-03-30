export type Role = "Admin" | "Staff";

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  password: string;
  role: Role;
  idNo?: string;
  permissions?: StaffPermissions;
}

export interface StaffPermissions {
  addProduct: boolean;
  editProduct: boolean;
  deleteProduct: boolean;
  archiveProduct: boolean;
  addItem: boolean;
  deleteItem: boolean;
}

export interface Product {
  id: string;
  name: string;
  size: string;
  category: string;
  cost: number; // This is actually selling price
  imageUrl?: string;
  brand?: string;
  archived?: boolean;
}

export interface DailyInventory {
  productId: string;
  beg: number; // Beginning inventory
  in: number; // Stock in
  total: number; // Total in warehouse (beg + in)
  out: number; // Stock out
  end: number; // End stock (total - out)
}

export interface InventorySheet {
  date: string; // format: "9-21-25"
  items: DailyInventory[];
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId?: string;
  userName: string;
  userEmail: string;
  userRole: Role;
  activity: string;
  productId?: string;
  productName?: string;
}

export interface AuthContextType {
  user: User | null;
  login: (username: string, password: string, selectedRole: Role) => Promise<boolean>;
  logout: () => void;
  isAdmin: boolean;
  hasPermission: (permission: keyof StaffPermissions) => boolean;
  updateUserLocal: (updates: Partial<Pick<User, "name" | "email" | "username">>) => void;
}

export interface InventoryContextType {
  products: Product[];
  inventorySheets: InventorySheet[];
  selectedDate: string;
  activityLogs: ActivityLog[];
  getInventoryForDate: (date: string) => DailyInventory[];
  getProductById: (id: string) => Product | undefined;
  addProduct: (product: NewProductInput) => Promise<boolean>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<boolean>;
  deleteProduct: (id: string) => Promise<boolean>;
  updateDailyInventory: (date: string, productId: string, updates: Partial<DailyInventory>) => Promise<boolean>;
  archiveProduct: (id: string) => Promise<boolean>;
  archiveAllProducts: () => Promise<boolean>;
  deleteAllProducts: () => Promise<boolean>;
  exportData: (targetDates?: string[]) => void;
  setSelectedDate: (date: string) => void;
  logActivity: (activity: string, productId?: string, productName?: string) => void;
}

export interface NewProductInput extends Omit<Product, "id"> {
  beginningStock: number;
  imageFile?: File | null;
}
