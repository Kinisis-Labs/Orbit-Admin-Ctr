export type EntraGroup = {
  id: string;
  displayName: string;
  description: string;
};

export type EntraUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  initial: string;
  isAdmin: boolean;
  isEngineer: boolean;
};
