export type SkillRow = {
  id: string;
  owner_uuid: string;
  name: string;
  description: string;
  instructions: string;
  user_invocable: boolean;
  disable_model_invocation: boolean;
  created_at: number;
  updated_at: number;
};
