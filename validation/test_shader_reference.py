"""Fresh product CPU fixtures. Old prototype tests are only provenance."""
import unittest
import numpy as np
from shader_reference import Constants,RECORD,refresh,reproject,read,store,half_d3d

class ProductShaderTests(unittest.TestCase):
    def setUp(self):
        self.c=Constants(8,8,8,8,8,8)
        self.b=np.empty((8,8,4),np.float32);self.b[...,:3]=[.25,.3125,.375];self.b[...,3]=.75
        self.e=self.b.copy();self.e[...,:3]=[.28125,.296875,.4375];self.e[...,3]=.125
        self.z=np.full((8,8),.5,np.float32);self.mv=np.zeros((8,8,2),np.float32)
        self.h,self.fresh=refresh(self.b,self.e,self.z,self.c,True)

    def test_record_is_full_edited_and_reference_not_residual(self):
        self.assertEqual(RECORD.itemsize,20)
        valid,edited,reference,depth=read(self.h,(2,2));self.assertTrue(valid)
        np.testing.assert_array_equal(edited,self.e[2,2,:3]);np.testing.assert_array_equal(reference,self.b[2,2,:3])
        self.assertEqual(depth,.5)

    def test_fresh_large_neural_edit_is_preserved_without_clipping(self):
        self.e[...,:3]=[8.125,100,2]
        h,out=refresh(self.b,self.e,self.z,self.c,True)
        np.testing.assert_array_equal(out[...,:3],self.e[...,:3]);self.assertTrue(h['valid'].all())

    def test_no_previous_history_is_needed_to_preserve_fresh_nr(self):
        self.h[:]=0
        _,out=refresh(self.b,self.e,self.z,self.c,True)
        np.testing.assert_array_equal(out[...,:3],self.e[...,:3])

    def test_invalid_depth_cache_keeps_fresh_nr(self):
        self.z[:]=np.nan
        h,out=refresh(self.b,self.e,self.z,self.c,True)
        self.assertFalse(h['valid'].any());np.testing.assert_array_equal(out[...,:3],self.e[...,:3])

    def test_invalid_reference_cache_keeps_valid_fresh_nr(self):
        self.b[...,:3]=np.inf
        h,out=refresh(self.b,self.e,self.z,self.c,True)
        self.assertFalse(h['valid'].any());np.testing.assert_array_equal(out[...,:3],self.e[...,:3])

    def test_uncacheable_large_fresh_nr_is_not_replaced(self):
        self.e[...,:3]=100000
        h,out=refresh(self.b,self.e,self.z,self.c,True)
        self.assertFalse(h['valid'].any());np.testing.assert_array_equal(out[...,:3],self.e[...,:3])

    def test_refresh_always_restores_current_alpha(self):
        np.testing.assert_array_equal(self.fresh[...,3],self.b[...,3])

    def test_zero_motion_all_edges_reuses_full_edit(self):
        out,nxt,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertTrue(valid.all());np.testing.assert_array_equal(out,self.fresh)

    def test_bright_reference_dark_edit_avoids_cancellation(self):
        self.b[...,:3]=1024;self.e[...,:3]=half_d3d(np.float32(.001)).astype(np.float32)
        h,fresh=refresh(self.b,self.e,self.z,self.c,True)
        out,_,valid=reproject(self.b,self.mv,self.z,h,self.c)
        self.assertTrue(valid.all());np.testing.assert_array_equal(out,fresh)
        self.assertTrue(np.all((out[...,:3]>.0009)&(out[...,:3]<.0011)))

    def test_half_maximum_is_cacheable(self):
        self.b[...,:3]=65504;self.e[...,:3]=65504
        h,_=refresh(self.b,self.e,self.z,self.c,True)
        self.assertTrue(h['valid'].all());out,_,valid=reproject(self.b,self.mv,self.z,h,self.c)
        self.assertTrue(valid.all());np.testing.assert_array_equal(out[...,:3],self.e[...,:3])

    def test_fractional_motion_interpolates_full_edits(self):
        for x in range(8):self.e[:,x,:3]=self.b[:,x,:3]+x/128
        h=refresh(self.b,self.e,self.z,self.c);self.mv[...,0]=-.5
        out,_,valid=reproject(self.b,self.mv,self.z,h,self.c)
        expected=(read(h,(2,2))[1]+read(h,(3,2))[1])/2
        np.testing.assert_array_equal(out[2,3,:3],expected);self.assertFalse(valid[2,0])

    def test_depth_rejection_preserves_exact_current(self):
        self.h[2,2]['depth']=.25
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertFalse(valid[2,2]);np.testing.assert_array_equal(out[2,2],self.b[2,2])

    def test_equal_luma_rgb_change_is_rejected(self):
        self.b[...,0]+=.15;self.b[...,1]-=.15*.2126/.7152
        self.c.color_relative=.01;self.c.color_absolute=.001
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertFalse(valid.any());np.testing.assert_array_equal(out,self.b)

    def test_positive_weight_neighbor_only(self):
        self.h[2,3]['depth']=.25
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertTrue(valid[2,2]);np.testing.assert_array_equal(out[2,2],self.fresh[2,2])

    def test_nonfinite_motion_and_invalid_history_preserve_current(self):
        self.mv[2,2]=np.nan;self.h[3,3]['valid']=0;self.h[4,4]['words'][0]=0x7c007c00
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        for p in ((2,2),(3,3),(4,4)):
            self.assertFalse(valid[p]);np.testing.assert_array_equal(out[p],self.b[p])

    def test_motion_cap_rejects_otherwise_inside_footprint(self):
        self.c.maximum_motion_pixels=.25;self.mv[:]=[.5,0]
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertFalse(valid.any());np.testing.assert_array_equal(out,self.b)

    def test_lowres_motion_and_depth_subrects(self):
        self.c.motion_width=self.c.motion_height=4;self.c.motion_x=self.c.motion_y=2
        self.c.depth_width=self.c.depth_height=4;self.c.depth_x=self.c.depth_y=1
        self.c.mv_to_output_x=2;self.mv[:]=np.nan;self.mv[2:6,2:6]=[-.5,0]
        self.z[:]=np.nan;self.z[1:5,1:5]=.5
        out,_,valid=reproject(self.b,self.mv,self.z,self.h,self.c)
        self.assertTrue(valid[2,2]);self.assertFalse(valid[2,0]);np.testing.assert_array_equal(out[2,2,:3],self.e[2,1,:3])

    def test_sdr_reference_uses_matching_half_precision_for_dark_edit(self):
        self.c.encoding=1;self.b[...,:3]=.99;self.e[...,:3]=.01
        h,_=refresh(self.b,self.e,self.z,self.c,True)
        out,_,valid=reproject(self.b,self.mv,self.z,h,self.c)
        self.assertTrue(valid.all());np.testing.assert_allclose(out[...,:3],self.e[...,:3],atol=1e-5)

    def test_d3d_half_conversion_rounds_toward_zero(self):
        vals=np.array([.001,-.01341986,1e-8,-1e-8],np.float32)
        half=half_d3d(vals).astype(np.float32);self.assertTrue(np.all(abs(half)<=abs(vals)))

if __name__=='__main__':unittest.main(verbosity=2)
