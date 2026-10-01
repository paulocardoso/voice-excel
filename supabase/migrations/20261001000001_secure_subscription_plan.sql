-- Subscription state is server-owned. Authenticated clients may update their
-- learning preferences, but cannot grant themselves a paid entitlement.

create or replace function public.prevent_client_plan_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' and new.plan <> 'free' then
      raise exception 'subscription plan is managed by the billing service';
    end if;
    if tg_op = 'UPDATE' and new.plan is distinct from old.plan then
      raise exception 'subscription plan is managed by the billing service';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_client_plan_mutation on public.profiles;
create trigger profiles_prevent_client_plan_mutation
before insert or update on public.profiles
for each row execute function public.prevent_client_plan_mutation();
