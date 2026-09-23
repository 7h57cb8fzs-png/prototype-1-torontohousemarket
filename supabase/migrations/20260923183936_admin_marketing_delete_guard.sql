-- Retain consent history and protect marketing sends during admin lead removal.
create or replace function public.admin_ops_lead_action(p_ids uuid[],p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_result jsonb:='[]'; v_found uuid; v_busy boolean;
begin
 if p_action not in ('archive','restore','delete') or coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'Choose 1–1000 leads and a valid action'; end if;
 for v_id in select distinct unnest(p_ids) order by 1 loop
  begin
   select id into v_found from public.leads where id=v_id for update nowait;
   if not found then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason','Lead no longer exists'); continue; end if;
   if p_action='delete' then
    perform 1 from public.seller_marketing_jobs where lead_id=v_id order by id for update nowait;
    if exists(select 1 from public.seller_marketing_jobs where lead_id=v_id and status='processing') then
     v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason','A marketing email is processing; wait until it finishes');continue;
    end if;
    update public.seller_marketing_jobs set status='suppressed',locked_at=null,last_error='Lead removed by administrator'
     where lead_id=v_id and status in ('queued','failed');
    perform public.remove_phase5_lead(v_id);
   else
    update public.leads set archived_at=case when p_action='archive' then now() else null end,updated_at=now() where id=v_id;
    insert into public.lead_events(lead_id,event_type,actor_type,payload) values(v_id,'admin_'||p_action,'admin','{}');
   end if;
   v_result:=v_result||jsonb_build_object('id',v_id,'ok',true);
  exception when lock_not_available then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason','Busy; refresh and try again');
   when others then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason',case when sqlerrm like '%processing%' then 'A report or email is processing; wait until it finishes' else 'This lead could not be changed' end);
  end;
 end loop;
 return jsonb_build_object('results',v_result);
end $$;

notify pgrst,'reload schema';
