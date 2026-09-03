GRANT SELECT ON public.questions TO authenticated;
CREATE POLICY "Authenticated can read questions" ON public.questions FOR SELECT TO authenticated USING (true);