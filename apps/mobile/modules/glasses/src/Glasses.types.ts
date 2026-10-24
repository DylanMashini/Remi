export type GlassesStatus = {
  connection: string;
};

export type GlassesModuleEvents = {
  onStatus: (status: GlassesStatus) => void;
};
